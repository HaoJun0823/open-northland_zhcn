import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPalettedSheetClient,
  IDLE_WORKER_TERMINATE_MS,
  type PalettedSheetWorker,
} from '../src/content/atlas-sheet/index.js';
import type { PalettedSheetReply, PalettedSheetRequest } from '../src/content/atlas-sheet/protocol.js';

/** A worker that records its requests and answers when told. */
class FakeWorker implements PalettedSheetWorker {
  readonly requests: PalettedSheetRequest[] = [];
  terminated = false;
  private onMessage: ((event: MessageEvent<PalettedSheetReply>) => void) | undefined;
  private onError: ((event: ErrorEvent) => void) | undefined;
  addEventListener(type: 'message', listener: (event: MessageEvent<PalettedSheetReply>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<PalettedSheetReply>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') this.onMessage = listener as (event: MessageEvent<PalettedSheetReply>) => void;
    else this.onError = listener as (event: ErrorEvent) => void;
  }
  postMessage(request: PalettedSheetRequest): void {
    this.requests.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(reply: PalettedSheetReply): void {
    this.onMessage?.({ data: reply } as MessageEvent<PalettedSheetReply>);
  }
  fail(message: string): void {
    this.onError?.({ message } as ErrorEvent);
  }
}

describe('createPalettedSheetClient', () => {
  it('sends every palette of one sheet to the same worker, spawning workers only as needed', () => {
    const spawned: FakeWorker[] = [];
    const colour = createPalettedSheetClient(() => {
      const worker = new FakeWorker();
      spawned.push(worker);
      return worker;
    }, 3);
    for (const palette of ['a', 'b', 'c']) void colour('https://x/bobs/sheet.webp', palette);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.requests.map((r) => r.palette)).toEqual(['a', 'b', 'c']);
  });

  it('settles each request by its id, and rejects an error reply and what a failed worker still owed', async () => {
    const worker = new FakeWorker();
    const colour = createPalettedSheetClient(() => worker, 1);
    const first = colour('u', 'p');
    const second = colour('u', 'q');
    const [, b] = worker.requests;
    worker.reply({ id: b?.id ?? -1, error: 'late' });
    await expect(second).rejects.toThrow(/late/);
    worker.fail('boom');
    await expect(first).rejects.toThrow(/boom/);
  });

  it('drops a worker whose script failed, rejecting only its own requests, and respawns on the next', async () => {
    const spawned: FakeWorker[] = [];
    const colour = createPalettedSheetClient(() => {
      const worker = new FakeWorker();
      spawned.push(worker);
      return worker;
    }, 2);
    // Four URLs spread over both slots.
    const urls = ['https://x/a.png', 'https://x/b.png', 'https://x/c.png', 'https://x/d.png'];
    const pending = urls.map((url) => colour(url, 'p'));
    expect(spawned).toHaveLength(2);
    const [broken, healthy] = spawned as [FakeWorker, FakeWorker];
    const brokenUrls = broken.requests.map((r) => r.url);
    broken.fail('404');
    expect(broken.terminated).toBe(true);
    for (const [i, url] of urls.entries()) {
      if (brokenUrls.includes(url)) await expect(pending[i]).rejects.toThrow(/404/);
    }
    // The healthy worker still answers what it owes.
    const bitmap = {} as ImageBitmap;
    for (const request of healthy.requests) healthy.reply({ id: request.id, bitmap });
    for (const [i, url] of urls.entries()) {
      if (!brokenUrls.includes(url)) await expect(pending[i]).resolves.toBe(bitmap);
    }
    // The failed slot spawns a fresh worker for its next request.
    void colour(brokenUrls[0] ?? '', 'q');
    expect(spawned).toHaveLength(3);
    expect(spawned[2]?.requests.map((r) => r.palette)).toEqual(['q']);
  });

  it('closes a bitmap that arrives after its request was rejected', async () => {
    const worker = new FakeWorker();
    const colour = createPalettedSheetClient(() => worker, 1);
    const owed = colour('u', 'p');
    worker.fail('boom');
    await expect(owed).rejects.toThrow(/boom/);
    const close = vi.fn();
    worker.reply({ id: worker.requests[0]?.id ?? -1, bitmap: { close } as unknown as ImageBitmap });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('createPalettedSheetClient idle workers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('terminates a worker idle past the limit and spawns again on the next request', async () => {
    vi.useFakeTimers();
    const spawned: FakeWorker[] = [];
    const colour = createPalettedSheetClient(() => {
      const worker = new FakeWorker();
      spawned.push(worker);
      return worker;
    }, 1);
    const first = colour('u', 'p');
    const [worker] = spawned as [FakeWorker];
    vi.advanceTimersByTime(IDLE_WORKER_TERMINATE_MS * 2);
    expect(worker.terminated).toBe(false); // a request is still owed
    worker.reply({ id: worker.requests[0]?.id ?? -1, bitmap: {} as ImageBitmap });
    await first;
    vi.advanceTimersByTime(IDLE_WORKER_TERMINATE_MS - 1);
    expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(worker.terminated).toBe(true);
    void colour('u', 'q');
    expect(spawned).toHaveLength(2);
  });
});
