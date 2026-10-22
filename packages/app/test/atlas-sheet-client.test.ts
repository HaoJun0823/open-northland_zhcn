import { describe, expect, it } from 'vitest';
import { createPalettedSheetClient, type PalettedSheetWorker } from '../src/content/atlas-sheet/index.js';
import type { PalettedSheetReply, PalettedSheetRequest } from '../src/content/atlas-sheet/protocol.js';

/** A worker that records its requests and answers when told. */
class FakeWorker implements PalettedSheetWorker {
  readonly requests: PalettedSheetRequest[] = [];
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
    for (const palette of ['a', 'b', 'c']) void colour('https://x/bobs/sheet.webp', palette, 'bitmap');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.requests.map((r) => r.palette)).toEqual(['a', 'b', 'c']);
  });

  it('settles each request by its id, and rejects what a failed worker still owed', async () => {
    const worker = new FakeWorker();
    const colour = createPalettedSheetClient(() => worker, 1);
    const first = colour('u', 'p', 'blob');
    const second = colour('u', 'q', 'blob');
    const [a, b] = worker.requests;
    worker.reply({ id: b?.id ?? -1, error: 'late' });
    await expect(second).resolves.toEqual({ id: b?.id, error: 'late' });
    worker.fail('boom');
    await expect(first).rejects.toThrow(/boom/);
    expect(a?.form).toBe('blob');
  });
});
