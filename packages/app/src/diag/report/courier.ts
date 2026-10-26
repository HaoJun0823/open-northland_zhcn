/**
 * Every upload goes through the outbox: it is stored before it is posted and leaves on an answer
 * that is not a retry, so a page reloaded or closed during a slow post sends it at its next start.
 * The server keeps the first copy of an id and answers a repeat as stored; a lock per upload keeps
 * another tab from posting one again while it is still on its way.
 */
import { diag } from '../log.js';
import {
  afterAttempt,
  dueEntries,
  nextDue,
  type OutboxEntry,
  type OutboxStore,
  outboxKey,
} from './outbox.js';
import type { SendResult } from './send.js';

/** Uploads one flush sends at most; the rest wait for the next. */
const FLUSH_BATCH = 20;

const LOCK_PREFIX = 'open-northland.report-upload:';

/** A lock per upload, shared by this browser's pages and let go when its page ends, however it ends. */
export interface UploadLocks {
  /** Run `post` holding the upload's lock, waiting for it. */
  hold<T>(key: string, post: () => Promise<T>): Promise<T>;
  /** Run `post` holding the upload's lock, or answer null at once while another page holds it. */
  tryHold<T>(key: string, post: () => Promise<T>): Promise<T | null>;
  /** Settles once no page holds the upload's lock. */
  released(key: string): Promise<void>;
}

/** The browser's Web Locks, absent outside a secure context. */
export function browserUploadLocks(): UploadLocks | null {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) return null;
  const name = (key: string): string => `${LOCK_PREFIX}${key}`;
  return {
    hold: (key, post) => locks.request(name(key), post),
    tryHold: (key, post) =>
      locks.request(name(key), { ifAvailable: true }, (lock) => (lock === null ? null : post())),
    released: (key) => locks.request(name(key), () => undefined),
  };
}

export interface CourierDeps {
  readonly store: OutboxStore;
  /** Without them every page posts what it finds due, and the server stores one copy. */
  readonly locks: UploadLocks | null;
  readonly post: (entry: OutboxEntry) => Promise<SendResult>;
  readonly now: () => number;
  /** The outbox sent one of its uploads: kept for a retry, or `dropped` after its last answer. */
  readonly settled: (entry: OutboxEntry, result: SendResult, dropped: boolean) => void;
}

export class Courier {
  /** The server's Retry-After holds every upload, not only the one it answered. */
  private blockedUntil = 0;
  /** Keys being posted, which a flush leaves alone. */
  private readonly posting = new Set<string>();
  /** Keys another page is posting, flushed again once it lets go: it got an answer, or it died. */
  private readonly postedElsewhere = new Set<string>();
  private flushing = false;
  /** A flush was asked for while one ran: the outbox changed under it. */
  private flushAgain = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: CourierDeps) {}

  /** Post `entry` now; the outbox holds it until it gets an answer other than a retry. */
  async deliver(entry: OutboxEntry): Promise<SendResult> {
    const wait = this.blockedUntil - this.deps.now();
    if (wait > 0) {
      await this.keep({ ...entry, notBefore: this.blockedUntil, heldByServer: true });
      return { kind: 'retry', afterMs: wait };
    }
    // Locked before it is stored, so no other page's flush takes it on its way.
    const post = async (): Promise<SendResult> => {
      await this.keep(entry, false);
      return (await this.attempt(entry)).result;
    };
    this.posting.add(entry.key);
    try {
      return await (this.deps.locks === null ? post() : this.deps.locks.hold(entry.key, post));
    } finally {
      this.posting.delete(entry.key);
    }
  }

  /** Keep `entry` for a later flush, which sends an addendum only after its report. */
  async queue(entry: OutboxEntry): Promise<void> {
    await this.keep(entry);
  }

  /**
   * Send what the outbox holds and is due, oldest first, until the link fails again. `linkBack`, for
   * a start and the browser's return online: the link may work again, so only the server's
   * Retry-After still holds an upload.
   */
  async flush(options: { readonly linkBack?: boolean } = {}): Promise<void> {
    if (this.deps.now() < this.blockedUntil) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    const linkBack = options.linkBack === true;
    try {
      for (let sent = 0; sent < FLUSH_BATCH; sent++) {
        const [entry] = this.waiting(await this.deps.store.list(), linkBack ? 'link-back' : 'due');
        if (entry === undefined) break;
        const attempt = await this.attemptExclusive(entry);
        if (attempt === null) continue;
        this.deps.settled(entry, attempt.result, attempt.dropped);
        if (attempt.result.kind === 'retry') break;
      }
      const due = nextDue(this.waiting(await this.deps.store.list(), 'all'));
      if (due !== null) this.schedule(due - this.deps.now());
    } catch (error) {
      diag.warn('report', 'outbox flush failed', error);
    } finally {
      this.flushing = false;
    }
    if (this.flushAgain) {
      this.flushAgain = false;
      await this.flush();
    }
  }

  /** Try the outbox after `afterMs`, never before the server's Retry-After ends. */
  schedule(afterMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(afterMs, this.blockedUntil - this.deps.now(), 0),
    );
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The entries no post holds: all of them, those due now, or those due once the link is back. */
  private waiting(entries: readonly OutboxEntry[], which: 'all' | 'due' | 'link-back'): OutboxEntry[] {
    // Due is decided on every entry: an addendum waits while its report is being posted.
    const candidates =
      which === 'all' ? entries : dueEntries(entries, this.deps.now(), which === 'link-back');
    return candidates.filter((entry) => !this.posting.has(entry.key) && !this.postedElsewhere.has(entry.key));
  }

  /** {@link attempt} under the upload's lock, or null while another page posts it. */
  private async attemptExclusive(
    entry: OutboxEntry,
  ): Promise<{ result: SendResult; dropped: boolean } | null> {
    const { locks } = this.deps;
    const post = () => this.attempt(entry);
    this.posting.add(entry.key);
    let attempt: { result: SendResult; dropped: boolean } | null;
    try {
      attempt = await (locks === null ? post() : locks.tryHold(entry.key, post));
    } finally {
      this.posting.delete(entry.key);
    }
    if (attempt === null && locks !== null) {
      this.postedElsewhere.add(entry.key);
      void locks.released(entry.key).then(() => {
        this.postedElsewhere.delete(entry.key);
        return this.flush();
      });
    }
    return attempt;
  }

  private async keep(entry: OutboxEntry, wake = true): Promise<void> {
    try {
      await this.deps.store.put(entry);
    } catch (error) {
      diag.warn('report', 'outbox write failed', error);
    }
    if (wake) this.schedule(entry.notBefore - this.deps.now());
  }

  /** One post of an entry the outbox holds, and the outbox updated by its answer. */
  private async attempt(entry: OutboxEntry): Promise<{ result: SendResult; dropped: boolean }> {
    const result = await this.deps.post(entry);
    if (result.kind === 'retry' && result.afterMs !== null)
      this.blockedUntil = Math.max(this.blockedUntil, this.deps.now() + result.afterMs);
    const outcome = afterAttempt(entry, result, this.deps.now());
    if (outcome.kind === 'keep') {
      await this.keep(outcome.entry);
      return { result, dropped: false };
    }
    // An addendum cannot follow a report the server does not store.
    const orphan =
      entry.part === 'report' && outcome.reason !== 'sent' ? [outboxKey(entry.id, 'addendum')] : [];
    try {
      await this.deps.store.remove([entry.key, ...orphan]);
    } catch (error) {
      diag.warn('report', 'outbox write failed', error);
    }
    if (outcome.reason !== 'sent' && outcome.reason !== 'counted')
      diag.warn('report', `dropped a ${entry.part}: ${outcome.reason}`, { id: entry.id });
    return { result, dropped: true };
  }
}
