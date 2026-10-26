import { createHmac, randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';
import type { ReportPart } from '@open-northland/data';

const MS_PER_SECOND = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KEY_SECRET_BYTES = 32;
/** An IPv6 client usually holds a whole /64, so its first four groups are one sender. */
const IPV6_SENDER_GROUPS = 4;
const IPV6_GROUPS = 8;
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

export interface RateLimits {
  readonly ipReportsPerHour: number;
  readonly ipReportsPerDay: number;
  readonly ipAddendaPerHour: number;
  readonly uploadsPerHour: number;
  readonly uploadBytesPerHour: number;
}

/** Upload times of one sender, oldest first, as long as they fall in that part's longest window. */
interface SenderLog {
  readonly reports: number[];
  readonly addenda: number[];
}

/** A refusal and how many whole seconds until a slot frees. */
export interface Limited {
  readonly retryAfterSeconds: number;
}

/**
 * Sliding-window upload limits in memory. Senders are keyed by an HMAC of their address under a
 * secret made at start, so the address itself is never kept and the keys mean nothing after a
 * restart. Every time is the clock when it is recorded, so each list stays in order. Only admitted
 * uploads create entries, so the global hourly count bounds the map.
 */
export class ReportLimiter {
  private readonly secret = randomBytes(KEY_SECRET_BYTES);
  private readonly senders = new Map<string, SenderLog>();
  private readonly uploads: number[] = [];
  /** Compressed bytes read per upload, oldest first. */
  private readonly received: { readonly time: number; readonly bytes: number }[] = [];
  private lastSweep = 0;

  constructor(private readonly limits: RateLimits) {}

  /** The limiter's key for a client address; IPv6 senders share one per /64. */
  senderKey(address: string): string {
    return createHmac('sha256', this.secret).update(senderOf(address)).digest('base64url');
  }

  /** Before reading a body: refuses while a global hourly budget or the sender's limit for `part` is
   *  spent, else takes a slot of both at once, so concurrent uploads cannot pass them. The bytes count
   *  once read, so uploads in flight may overshoot the byte budget. */
  admit(key: string, part: ReportPart, now: number): Limited | null {
    this.sweep(now);
    prune(this.uploads, now - HOUR_MS);
    const known = this.senders.get(key);
    const wait =
      waitFor(this.uploads, this.limits.uploadsPerHour, HOUR_MS, now) ??
      this.bytesWait(now) ??
      (known === undefined ? null : this.partWait(known, part, now));
    if (wait !== null) return wait;
    this.uploads.push(now);
    const sender = known ?? this.senderLog(key);
    (part === 'report' ? sender.reports : sender.addenda).push(now);
    return null;
  }

  /** Counts an upload's compressed bytes, read whole or cut at its limit, against the hourly budget. */
  countBytes(bytes: number, now: number): void {
    this.received.push({ time: now, bytes });
  }

  /** An upload the server could not read or validate also spends the sender's slot for the other
   *  part, so a sender of garbage runs out soonest. */
  penalize(key: string, part: ReportPart, now: number): void {
    const sender = this.senderLog(key);
    (part === 'report' ? sender.addenda : sender.reports).push(now);
  }

  private partWait(sender: SenderLog, part: ReportPart, now: number): Limited | null {
    if (part === 'addendum') {
      prune(sender.addenda, now - HOUR_MS);
      return waitFor(sender.addenda, this.limits.ipAddendaPerHour, HOUR_MS, now);
    }
    prune(sender.reports, now - DAY_MS);
    return (
      waitFor(sender.reports, this.limits.ipReportsPerDay, DAY_MS, now) ??
      waitFor(sender.reports, this.limits.ipReportsPerHour, HOUR_MS, now)
    );
  }

  /** The wait until the bytes read in the last hour fall below the budget, or null now. */
  private bytesWait(now: number): Limited | null {
    while ((this.received[0]?.time ?? now) <= now - HOUR_MS) this.received.shift();
    let total = this.received.reduce((sum, { bytes }) => sum + bytes, 0);
    for (const { time, bytes } of this.received) {
      if (total < this.limits.uploadBytesPerHour) break;
      total -= bytes;
      if (total < this.limits.uploadBytesPerHour) return waitUntil(time + HOUR_MS, now);
    }
    return null;
  }

  private senderLog(key: string): SenderLog {
    let sender = this.senders.get(key);
    if (sender === undefined) {
      sender = { reports: [], addenda: [] };
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
      if (sender.reports.length === 0 && sender.addenda.length === 0) this.senders.delete(key);
    }
  }
}

function prune(times: number[], since: number): void {
  let stale = 0;
  while (stale < times.length && (times[stale] ?? 0) <= since) stale++;
  times.splice(0, stale);
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

function senderOf(address: string): string {
  const mapped = IPV4_MAPPED.exec(address)?.[1];
  if (mapped !== undefined) return mapped;
  if (!isIPv6(address)) return address;
  const [head = '', tail = ''] = address.toLowerCase().split('%', 1)[0]?.split('::') ?? [];
  const front = head === '' ? [] : head.split(':');
  const back = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...front, ...Array<string>(Math.max(0, IPV6_GROUPS - front.length - back.length)).fill('0'), ...back]
    : front;
  return groups
    .slice(0, IPV6_SENDER_GROUPS)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}
