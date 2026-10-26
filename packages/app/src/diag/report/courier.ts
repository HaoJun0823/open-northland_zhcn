/**
 * Every upload goes through the outbox: it is stored before it is posted and leaves on an answer
 * that is not a retry, so a page reloaded or closed during a slow post sends it at its next start.
 * The server keeps the first copy of an id and answers a repeat as stored.
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

export interface CourierDeps {
  readonly store: OutboxStore;
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
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: CourierDeps) {}

  /** Post `entry` now; the outbox holds it until it gets an answer other than a retry. */
  async deliver(entry: OutboxEntry): Promise<SendResult> {
    const wait = this.blockedUntil - this.deps.now();
    if (wait > 0) {
      await this.keep({ ...entry, notBefore: this.blockedUntil });
      return { kind: 'retry', afterMs: wait };
    }
    this.posting.add(entry.key);
    try {
      await this.keep(entry, false);
      return (await this.attempt(entry)).result;
    } finally {
      this.posting.delete(entry.key);
    }
  }

  /** Keep `entry` for a later flush, which sends an addendum only after its report. */
  async queue(entry: OutboxEntry): Promise<void> {
    await this.keep(entry);
  }

  /** Send what the outbox holds and is due, oldest first, until the link fails again. */
  async flush(): Promise<void> {
    if (this.flushing || this.deps.now() < this.blockedUntil) return;
    this.flushing = true;
    try {
      for (let sent = 0; sent < FLUSH_BATCH; sent++) {
        const [entry] = this.waiting(await this.deps.store.list(), true);
        if (entry === undefined) break;
        this.posting.add(entry.key);
        let result: SendResult;
        let dropped: boolean;
        try {
          ({ result, dropped } = await this.attempt(entry));
        } finally {
          this.posting.delete(entry.key);
        }
        this.deps.settled(entry, result, dropped);
        if (result.kind === 'retry') break;
      }
      const due = nextDue(this.waiting(await this.deps.store.list(), false));
      if (due !== null) this.schedule(due - this.deps.now());
    } catch (error) {
      diag.warn('report', 'outbox flush failed', error);
    } finally {
      this.flushing = false;
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

  /** The entries no post holds, only those due now when `dueOnly`. */
  private waiting(entries: readonly OutboxEntry[], dueOnly: boolean): OutboxEntry[] {
    // Due is decided on every entry: an addendum waits while its report is being posted.
    const candidates = dueOnly ? dueEntries(entries, this.deps.now()) : entries;
    return candidates.filter((entry) => !this.posting.has(entry.key));
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
