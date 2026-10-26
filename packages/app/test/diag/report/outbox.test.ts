import { describe, expect, it } from 'vitest';
import {
  admit,
  afterAttempt,
  dueEntries,
  OUTBOX_LARGE_BYTES,
  OUTBOX_LARGE_MAX_ATTEMPTS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_ENTRIES,
  type OutboxEntry,
  outboxEntry,
} from '../../../src/diag/report/outbox.js';

const body = (bytes = 10) => new Uint8Array(new ArrayBuffer(bytes));
const NOW = 1_000_000;

describe('report outbox', () => {
  it('keeps what a later try can send, no sooner than the server asked, and gives up in the end', () => {
    const entry = outboxEntry('a'.repeat(32), 'report', body(), NOW);
    const kept = afterAttempt(entry, { kind: 'retry', afterMs: 600_000 }, NOW);
    expect(kept.kind).toBe('keep');
    if (kept.kind === 'keep') expect(kept.entry.notBefore).toBe(NOW + 600_000);
    expect(
      afterAttempt({ ...entry, attempts: OUTBOX_MAX_ATTEMPTS - 1 }, { kind: 'retry', afterMs: null }, NOW)
        .kind,
    ).toBe('drop');
    for (const kind of ['sent', 'full', 'unknown'] as const)
      expect(afterAttempt(entry, { kind }, NOW).kind).toBe('drop');
    const large = outboxEntry('c'.repeat(32), 'addendum', body(OUTBOX_LARGE_BYTES), NOW);
    const lastTry = { ...large, attempts: OUTBOX_LARGE_MAX_ATTEMPTS - 1 };
    expect(afterAttempt(lastTry, { kind: 'retry', afterMs: null }, NOW).kind).toBe('drop');
  });

  it('lets the oldest uploads go when it is full', () => {
    const entries: OutboxEntry[] = Array.from({ length: OUTBOX_MAX_ENTRIES }, (_, i) =>
      outboxEntry(i.toString(16).padStart(32, '0'), 'report', body(), NOW + i),
    );
    const incoming = outboxEntry('f'.repeat(32), 'report', body(), NOW + 100);
    const { kept, evicted } = admit(entries, incoming);
    expect(evicted).toEqual([entries[0]?.key]);
    expect(kept).toHaveLength(OUTBOX_MAX_ENTRIES);
    expect(kept.at(-1)).toBe(incoming);
  });

  it('sends an addendum only after its report left the outbox', () => {
    const id = 'b'.repeat(32);
    const report = outboxEntry(id, 'report', body(), NOW);
    const addendum = outboxEntry(id, 'addendum', body(), NOW);
    expect(dueEntries([addendum, report], NOW)).toEqual([report]);
    expect(dueEntries([addendum], NOW)).toEqual([addendum]);
    expect(dueEntries([{ ...report, notBefore: NOW + 1 }], NOW)).toEqual([]);
  });
});
