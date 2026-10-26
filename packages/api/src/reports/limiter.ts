import { createHmac, randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';
import type { ReportPart } from '@open-northland/data';

const MS_PER_SECOND = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KEY_SECRET_BYTES = 32;
/** An IPv6 client usually holds a whole /64, so its first four groups are one sender. */
const IPV6_SENDER_GROUPS = 4;
/** One site or household usually holds a /56: its /64s share a coarser limit as well. */
const IPV6_NETWORK_BITS = 56;
const BITS_PER_GROUP = 16;
const HEX = 16;
/** A /56's limits, as a multiple of one sender's. */
const NETWORK_LIMIT_FACTOR = 3;
const IPV6_GROUPS = 8;
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

export interface RateLimits {
  readonly ipReportsPerHour: number;
  readonly ipReportsPerDay: number;
  readonly ipAddendaPerHour: number;
  readonly uploadsPerHour: number;
  readonly uploadBytesPerHour: number;
  readonly ipUploadBytesPerHour: number;
}

/** Bytes counted at one time. */
interface Received {
  readonly time: number;
  readonly bytes: number;
}

/** Upload times and bytes of one sender, oldest first, as long as they fall in their longest window. */
interface SenderLog {
  readonly reports: number[];
  readonly addenda: number[];
  readonly received: Received[];
}

/** The limiter's keys for one client: its own, and its IPv6 /56 shared with its neighbours. */
export interface ReportSender {
  readonly key: string;
  readonly network: string | null;
}

/** A refusal and how many whole seconds until a slot frees. */
export interface Limited {
  readonly retryAfterSeconds: number;
}

/**
 * Sliding-window upload limits in memory. Senders are keyed by an HMAC of their address under a
 * secret made at start, so the address itself is never kept and the keys mean nothing after a
 * restart. Every time is the clock when it is recorded, so each list stays in order. Only admitted
 * uploads create entries, so the map holds at most a few entries per client address or /56 an hour.
 */
export class ReportLimiter {
  private readonly secret = randomBytes(KEY_SECRET_BYTES);
  private readonly senders = new Map<string, SenderLog>();
  private readonly uploads: number[] = [];
  /** Bytes counted from all senders, oldest first. */
  private readonly received: Received[] = [];
  private lastSweep = 0;

  constructor(private readonly limits: RateLimits) {}

  /** The limiter's keys for a client address; IPv6 senders share one per /64 and one per /56. */
  senderKey(address: string): ReportSender {
    const network = networkOf(address);
    return {
      key: this.keyOf(senderOf(address)),
      network: network === null ? null : this.keyOf(`net:${network}`),
    };
  }

  /** Before reading a body: refuses while a global hourly budget or the sender's limit for `part` or
   *  its share of the byte budget is spent, else takes a slot of each count at once, so concurrent
   *  uploads cannot pass them. The bytes count once read, so uploads in flight may overshoot a byte
   *  budget. */
  admit(sender: ReportSender, part: ReportPart, now: number): Limited | null {
    this.sweep(now);
    prune(this.uploads, now - HOUR_MS);
    const tiers = this.tiersOf(sender);
    let wait =
      waitFor(this.uploads, this.limits.uploadsPerHour, HOUR_MS, now) ??
      bytesWait(this.received, this.limits.uploadBytesPerHour, now);
    for (const [key, factor] of tiers) {
      const known = this.senders.get(key);
      wait ??=
        known === undefined
          ? null
          : (this.partWait(known, part, factor, now) ??
            bytesWait(known.received, this.limits.ipUploadBytesPerHour * factor, now));
    }
    if (wait !== null) return wait;
    this.uploads.push(now);
    for (const [key] of tiers) this.logOf(key, part).push(now);
    return null;
  }

  /** Gives back the global upload slot `admit` took at `admittedAt`, for an upload refused or lost
   *  before anything was stored; the sender's slots stay spent. */
  refund(admittedAt: number): void {
    const index = this.uploads.lastIndexOf(admittedAt);
    if (index !== -1) this.uploads.splice(index, 1);
  }

  /** Counts bytes against the hourly budget and the sender's share of it: an upload's compressed
   *  body, read whole or cut at its limit, and what its files take beyond that. */
  countBytes(sender: ReportSender, bytes: number, now: number): void {
    this.received.push({ time: now, bytes });
    for (const [key] of this.tiersOf(sender)) this.senderLog(key).received.push({ time: now, bytes });
  }

  /** An upload the server could not read or validate also spends the sender's slot for the other
   *  part, so a sender of garbage runs out soonest. */
  penalize(sender: ReportSender, part: ReportPart, now: number): void {
    const other = part === 'report' ? 'addendum' : 'report';
    for (const [key] of this.tiersOf(sender)) this.logOf(key, other).push(now);
  }

  private keyOf(sender: string): string {
    return createHmac('sha256', this.secret).update(sender).digest('base64url');
  }

  /** Each key of the sender and the multiple of the per-sender limits it may use. */
  private tiersOf(sender: ReportSender): readonly (readonly [key: string, factor: number])[] {
    return sender.network === null
      ? [[sender.key, 1]]
      : [
          [sender.key, 1],
          [sender.network, NETWORK_LIMIT_FACTOR],
        ];
  }

  private partWait(sender: SenderLog, part: ReportPart, factor: number, now: number): Limited | null {
    if (part === 'addendum') {
      prune(sender.addenda, now - HOUR_MS);
      return waitFor(sender.addenda, this.limits.ipAddendaPerHour * factor, HOUR_MS, now);
    }
    prune(sender.reports, now - DAY_MS);
    return (
      waitFor(sender.reports, this.limits.ipReportsPerDay * factor, DAY_MS, now) ??
      waitFor(sender.reports, this.limits.ipReportsPerHour * factor, HOUR_MS, now)
    );
  }

  private logOf(key: string, part: ReportPart): number[] {
    const sender = this.senderLog(key);
    return part === 'report' ? sender.reports : sender.addenda;
  }

  private senderLog(key: string): SenderLog {
    let sender = this.senders.get(key);
    if (sender === undefined) {
      sender = { reports: [], addenda: [], received: [] };
      this.senders.set(key, sender);
    }
    return sender;
  }

  /** Drops senders whose every upload left its window; runs at most hourly. */
  private sweep(now: number): void {
    if (now - this.lastSweep < HOUR_MS) return;
    this.lastSweep = now;
    for (const [key, sender] of this.senders) {
      prune(sender.reports, now - DAY_MS);
      prune(sender.addenda, now - HOUR_MS);
      pruneBytes(sender.received, now);
      if (sender.reports.length + sender.addenda.length + sender.received.length === 0) {
        this.senders.delete(key);
      }
    }
  }
}

function prune(times: number[], since: number): void {
  let stale = 0;
  while (stale < times.length && (times[stale] ?? 0) <= since) stale++;
  times.splice(0, stale);
}

function pruneBytes(received: Received[], now: number): void {
  while ((received[0]?.time ?? now) <= now - HOUR_MS) received.shift();
}

/** The wait until the bytes counted in the last hour fall below `limit`, or null now. */
function bytesWait(received: Received[], limit: number, now: number): Limited | null {
  pruneBytes(received, now);
  let total = received.reduce((sum, { bytes }) => sum + bytes, 0);
  for (const { time, bytes } of received) {
    if (total < limit) break;
    total -= bytes;
    if (total < limit) return waitUntil(time + HOUR_MS, now);
  }
  return null;
}

/** The wait until `times` holds fewer than `limit` entries newer than `window`, or null now. */
function waitFor(times: readonly number[], limit: number, window: number, now: number): Limited | null {
  const inWindow = times.filter((time) => time > now - window);
  if (inWindow.length < limit) return null;
  return waitUntil((inWindow[inWindow.length - limit] ?? now) + window, now);
}

function waitUntil(freesAt: number, now: number): Limited {
  return { retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / MS_PER_SECOND)) };
}

/** The eight groups of an IPv6 address as numbers, or null for any other address. */
function ipv6Groups(address: string): number[] | null {
  if (IPV4_MAPPED.test(address) || !isIPv6(address)) return null;
  const [head = '', tail = ''] = address.toLowerCase().split('%', 1)[0]?.split('::') ?? [];
  const front = head === '' ? [] : head.split(':');
  const back = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...front, ...Array<string>(Math.max(0, IPV6_GROUPS - front.length - back.length)).fill('0'), ...back]
    : front;
  return groups.map((group) => Number.parseInt(group, HEX) || 0);
}

function senderOf(address: string): string {
  const mapped = IPV4_MAPPED.exec(address)?.[1];
  if (mapped !== undefined) return mapped;
  const groups = ipv6Groups(address);
  if (groups === null) return address;
  return groups
    .slice(0, IPV6_SENDER_GROUPS)
    .map((group) => group.toString(HEX))
    .join(':');
}

/** The address's IPv6 /56 as text, or null for IPv4. */
function networkOf(address: string): string | null {
  const groups = ipv6Groups(address);
  if (groups === null) return null;
  const whole = Math.floor(IPV6_NETWORK_BITS / BITS_PER_GROUP);
  const partBits = IPV6_NETWORK_BITS % BITS_PER_GROUP;
  const prefix = groups.slice(0, whole);
  prefix.push((groups[whole] ?? 0) >> (BITS_PER_GROUP - partBits));
  return `${prefix.map((group) => group.toString(HEX)).join(':')}/${IPV6_NETWORK_BITS}`;
}
