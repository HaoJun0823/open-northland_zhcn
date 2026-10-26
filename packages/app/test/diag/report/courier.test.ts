import { afterEach, describe, expect, it, vi } from 'vitest';
import { Courier, type UploadLocks } from '../../../src/diag/report/courier.js';
import { memoryOutbox, type OutboxEntry, outboxEntry } from '../../../src/diag/report/outbox.js';
import type { SendResult } from '../../../src/diag/report/send.js';

const NOW = 1_000_000;
const id = (n: number) => n.toString(16).padStart(32, '0');
const body = () => new Uint8Array(new ArrayBuffer(10));

const couriers: Courier[] = [];
afterEach(() => {
  for (const courier of couriers.splice(0)) courier.stop();
});

/** A courier over a fresh outbox whose posts answer from `answers` in turn, `sent` once they run out. */
function courierWith(answers: SendResult[], locks: UploadLocks | null = null) {
  const store = memoryOutbox();
  const posted: OutboxEntry[] = [];
  const settled: { key: string; kind: SendResult['kind']; dropped: boolean }[] = [];
  const courier = new Courier({
    store,
    locks,
    post: async (entry) => {
      posted.push(entry);
      return answers.shift() ?? { kind: 'sent' };
    },
    now: () => NOW,
    settled: (entry, result, dropped) => settled.push({ key: entry.key, kind: result.kind, dropped }),
  });
  couriers.push(courier);
  return { courier, store, posted, settled };
}

describe('report courier', () => {
  it('holds an upload in the outbox while it is posted, so a closed page sends it again', async () => {
    const store = memoryOutbox();
    let answer: (result: SendResult) => void = () => undefined;
    const courier = new Courier({
      store,
      locks: null,
      post: () => new Promise((resolve) => (answer = resolve)),
      now: () => NOW,
      settled: () => undefined,
    });
    couriers.push(courier);
    const delivered = courier.deliver(outboxEntry(id(1), 'report', body(), NOW));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await store.list()).map((entry) => entry.id)).toEqual([id(1)]);
    // A flush meanwhile leaves the upload to its post.
    await courier.flush();
    answer({ kind: 'sent' });
    expect(await delivered).toEqual({ kind: 'sent' });
    expect(await store.list()).toEqual([]);
  });

  it('stops a flush at the first retry and keeps that upload for later', async () => {
    const { courier, store, posted, settled } = courierWith([{ kind: 'retry', afterMs: 60_000 }]);
    for (const n of [1, 2, 3]) await courier.queue(outboxEntry(id(n), 'report', body(), NOW - 10 + n));
    await courier.flush();

    expect(posted.map((entry) => entry.id)).toEqual([id(1)]);
    expect(settled).toEqual([{ key: `${id(1)}:report`, kind: 'retry', dropped: false }]);
    const kept = (await store.list()).find((entry) => entry.id === id(1));
    expect(kept?.attempts).toBe(1);
    expect(kept?.notBefore).toBe(NOW + 60_000);
  });

  it('settles each upload it sends and drops the addendum of a report the server did not store', async () => {
    const { courier, store, posted, settled } = courierWith([{ kind: 'counted' }]);
    await courier.queue(outboxEntry(id(1), 'report', body(), NOW - 2));
    await courier.queue(outboxEntry(id(1), 'addendum', body(), NOW - 2));
    await courier.queue(outboxEntry(id(2), 'report', body(), NOW - 1));
    await courier.flush();

    expect(posted.map((entry) => entry.key)).toEqual([`${id(1)}:report`, `${id(2)}:report`]);
    expect(settled).toEqual([
      { key: `${id(1)}:report`, kind: 'counted', dropped: true },
      { key: `${id(2)}:report`, kind: 'sent', dropped: true },
    ]);
    expect(await store.list()).toEqual([]);
  });

  it("sends what a lost link held back once the link may be back, but never before the server's Retry-After", async () => {
    const { courier, store, posted } = courierWith([]);
    const lost = { ...outboxEntry(id(1), 'report', body(), NOW - 2), attempts: 1, notBefore: NOW + 30_000 };
    const limited = {
      ...outboxEntry(id(2), 'report', body(), NOW - 1),
      attempts: 1,
      notBefore: NOW + 60_000,
    };
    await store.put(lost);
    await store.put({ ...limited, heldByServer: true });
    await courier.flush();
    expect(posted).toEqual([]);

    await courier.flush({ linkBack: true });
    expect(posted.map((entry) => entry.id)).toEqual([id(1)]);
  });

  it('leaves an upload to the page posting it, and sends it once that page let go unanswered', async () => {
    let letGo: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (letGo = resolve));
    let elsewhere = true;
    const locks: UploadLocks = {
      hold: (_key, post) => post(),
      tryHold: async (key, post) => (elsewhere && key === `${id(1)}:report` ? null : post()),
      released: () => released,
    };
    const { courier, store, posted } = courierWith([], locks);
    await courier.queue(outboxEntry(id(1), 'report', body(), NOW - 2));
    await courier.queue(outboxEntry(id(2), 'report', body(), NOW - 1));
    await courier.flush();
    expect(posted.map((entry) => entry.id)).toEqual([id(2)]);

    // The other page died mid-post: its lock is gone, its upload still waits.
    elsewhere = false;
    letGo();
    await vi.waitFor(() => expect(posted.map((entry) => entry.id)).toEqual([id(2), id(1)]));
    expect(await store.list()).toEqual([]);
  });
});
