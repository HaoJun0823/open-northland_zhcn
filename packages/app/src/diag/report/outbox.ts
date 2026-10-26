/**
 * Uploads that could not go out yet, kept in IndexedDB so a report written on a dropped link still
 * arrives: tried again at the next start, when the browser comes back online and after a backoff.
 */
import type { ReportPart } from '@open-northland/data';
import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import type { SendResult } from './send.js';

export interface OutboxEntry {
  readonly key: string;
  readonly id: string;
  readonly part: ReportPart;
  readonly body: Uint8Array<ArrayBuffer>;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  readonly attempts: number;
  /** No try before this epoch millisecond: a backoff or the server's Retry-After. */
  readonly notBefore: number;
}

const MIB = 1024 * 1024;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A few reports and their addenda; the oldest leave first. */
export const OUTBOX_MAX_ENTRIES = 10;
export const OUTBOX_MAX_BYTES = 16 * MIB;
export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_MAX_AGE_MS = 7 * DAY_MS;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * MINUTE_MS;

export function outboxKey(id: string, part: ReportPart): string {
  return `${id}:${part}`;
}

export function outboxEntry(
  id: string,
  part: ReportPart,
  body: Uint8Array<ArrayBuffer>,
  now: number,
): OutboxEntry {
  return { key: outboxKey(id, part), id, part, body, createdAt: now, attempts: 0, notBefore: now };
}

/** Doubling from half a minute to half an hour, and never sooner than the server asked. */
export function retryDelayMs(attempts: number, serverAfterMs: number | null): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.max(backoff, serverAfterMs ?? 0);
}

export type AttemptOutcome =
  | { readonly kind: 'keep'; readonly entry: OutboxEntry }
  | { readonly kind: 'drop'; readonly reason: 'sent' | 'full' | 'rejected' | 'unknown' | 'expired' };

export function afterAttempt(entry: OutboxEntry, result: SendResult, now: number): AttemptOutcome {
  if (result.kind !== 'retry') return { kind: 'drop', reason: result.kind };
  const attempts = entry.attempts + 1;
  if (attempts >= OUTBOX_MAX_ATTEMPTS || now - entry.createdAt > OUTBOX_MAX_AGE_MS) {
    return { kind: 'drop', reason: 'expired' };
  }
  return {
    kind: 'keep',
    entry: { ...entry, attempts, notBefore: now + retryDelayMs(attempts, result.afterMs) },
  };
}

/** `incoming` added in place of an entry with its key; the oldest others leave while over the caps. */
export function admit(
  entries: readonly OutboxEntry[],
  incoming: OutboxEntry,
): { readonly kept: OutboxEntry[]; readonly evicted: string[] } {
  if (incoming.body.byteLength > OUTBOX_MAX_BYTES) {
    return { kept: entries.filter((entry) => entry.key !== incoming.key), evicted: [incoming.key] };
  }
  const others = entries
    .filter((entry) => entry.key !== incoming.key)
    .sort((a, b) => a.createdAt - b.createdAt);
  const evicted: string[] = [];
  let bytes = others.reduce((sum, entry) => sum + entry.body.byteLength, incoming.body.byteLength);
  while (others.length > 0 && (others.length + 1 > OUTBOX_MAX_ENTRIES || bytes > OUTBOX_MAX_BYTES)) {
    const oldest = others.shift();
    if (oldest === undefined) break;
    bytes -= oldest.body.byteLength;
    evicted.push(oldest.key);
  }
  return { kept: [...others, incoming], evicted };
}

/** The entries due at `now`, oldest first; an addendum waits while its report is still queued. */
export function dueEntries(entries: readonly OutboxEntry[], now: number): OutboxEntry[] {
  const queuedReports = new Set(entries.filter((entry) => entry.part === 'report').map((entry) => entry.id));
  return entries
    .filter((entry) => entry.notBefore <= now && (entry.part === 'report' || !queuedReports.has(entry.id)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The soonest a waiting entry may go, or null for an empty outbox. */
export function nextDue(entries: readonly OutboxEntry[]): number | null {
  return entries.reduce<number | null>(
    (soonest, entry) => (soonest === null ? entry.notBefore : Math.min(soonest, entry.notBefore)),
    null,
  );
}

const DB_NAME = 'open-northland-reports';
const STORE = 'outbox';

function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === 'string' &&
    typeof entry.id === 'string' &&
    (entry.part === 'report' || entry.part === 'addendum') &&
    entry.body instanceof Uint8Array &&
    typeof entry.createdAt === 'number' &&
    typeof entry.attempts === 'number' &&
    typeof entry.notBefore === 'number'
  );
}

async function inOutbox<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => T): Promise<T> {
  const db = await openDb(DB_NAME, (created) => created.createObjectStore(STORE, { keyPath: 'key' }));
  try {
    const txn = db.transaction(STORE, mode);
    const result = run(txn.objectStore(STORE));
    await completed(txn);
    return result;
  } finally {
    db.close();
  }
}

/** The outbox in this browser's IndexedDB; a browser without it keeps nothing past the page. */
export interface OutboxStore {
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export function browserOutbox(): OutboxStore {
  return {
    async list() {
      const request = await inOutbox('readonly', (store) => store.getAll());
      return (request.result as unknown[]).filter(isEntry);
    },
    async put(incoming) {
      const entries = await this.list();
      const { kept, evicted } = admit(entries, incoming);
      await inOutbox('readwrite', (store) => {
        for (const key of evicted) store.delete(key);
        if (kept.some((entry) => entry.key === incoming.key)) store.put(incoming);
      });
    },
    async remove(keys) {
      if (keys.length === 0) return;
      await inOutbox('readwrite', (store) => {
        for (const key of keys) store.delete(key);
      });
    },
  };
}
