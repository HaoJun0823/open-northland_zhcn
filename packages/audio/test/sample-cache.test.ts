import { type SoundBanksDocument, type SoundQuality, soundBankPath } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { DECODED_BYTES_PER_SAMPLE, type PreloadSample } from '../src/index.js';
import { SampleCache } from '../src/web/engine/sample-cache.js';
import { NO_SOUND_BANKS, servingSoundBanks } from './helpers/fake-audio.js';

/** A decoded wav of `frames` mono frames: the fake decoder reads the frame count off the byte length. */
const BYTES_PER_FRAME = 1;
/** Every test clip: a hundred frames, so a budget counts in clips. */
const CLIP_FRAMES = 100;
const CLIP_BYTES = CLIP_FRAMES * DECODED_BYTES_PER_SAMPLE;

interface Harness {
  readonly cache: SampleCache;
  readonly fetched: string[];
  /** The fetches still waiting, in the order they were asked for. */
  readonly pending: Array<{ readonly file: string; readonly release: () => void }>;
}

function makeCache(
  opts: {
    budgetClips?: number;
    concurrency?: number;
    held?: boolean;
    missing?: string;
    banks?: SoundBanksDocument | null;
    quality?: SoundQuality;
  } = {},
): Harness {
  const fetched: string[] = [];
  const pending: Harness['pending'] = [];
  const serve = async (url: string): Promise<ArrayBuffer> => {
    const file = url.slice('/sounds/'.length);
    fetched.push(file);
    if (opts.held === true) await new Promise<void>((release) => pending.push({ file, release }));
    if (file === opts.missing) throw new Error('missing clip');
    // A bank holds every clip its index places in it, back to back.
    const bankClips = Object.values(opts.banks?.clips ?? {}).filter(
      (entry) => soundBankPath(entry.bank, opts.quality ?? 'lossless') === file,
    ).length;
    return new ArrayBuffer(Math.max(1, bankClips) * CLIP_FRAMES * BYTES_PER_FRAME);
  };
  const cache = new SampleCache(
    '/sounds/',
    opts.banks === null ? serve : servingSoundBanks(serve, opts.banks ?? NO_SOUND_BANKS),
    async (bytes) =>
      ({
        length: bytes.byteLength / BYTES_PER_FRAME,
        numberOfChannels: 1,
        duration: 1,
      }) as unknown as AudioBuffer,
    {
      ...(opts.budgetClips !== undefined ? { budgetBytes: opts.budgetClips * CLIP_BYTES } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.quality !== undefined ? { quality: opts.quality } : {}),
    },
  );
  return { cache, fetched, pending };
}

const samples = (files: readonly string[], pinned: boolean): PreloadSample[] =>
  files.map((file) => ({ file, pinned }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('SampleCache preload', () => {
  it('loads in plan order, a bounded number at a time', async () => {
    const { cache, fetched, pending } = makeCache({ concurrency: 2, held: true });
    const done = cache.preload(samples(['a.wav', 'b.wav', 'c.wav', 'd.wav'], true));
    await settle();
    expect(fetched).toEqual(['a.flac', 'b.flac']);
    pending.shift()?.release();
    await settle();
    expect(fetched).toEqual(['a.flac', 'b.flac', 'c.flac']);
    while (pending.length > 0) {
      pending.shift()?.release();
      await settle();
    }
    const report = await done;
    expect(fetched).toEqual(['a.flac', 'b.flac', 'c.flac', 'd.flac']);
    expect(report).toEqual({
      decoded: 4,
      failed: 0,
      skipped: 0,
      cachedBytes: 4 * CLIP_BYTES,
      pinnedBytes: 4 * CLIP_BYTES,
    });
  });

  it('starts no further wav once its stop condition holds', async () => {
    const { cache, fetched, pending } = makeCache({ concurrency: 2, held: true });
    let stopped = false;
    const done = cache.preload(samples(['a.wav', 'b.wav', 'c.wav', 'd.wav'], true), () => stopped);
    await settle();
    stopped = true;
    for (const { release } of pending.splice(0)) release();
    const report = await done;
    expect(fetched).toEqual(['a.flac', 'b.flac']);
    expect(report.decoded).toBe(2);
  });

  it('counts a failed wav and never fetches it again', async () => {
    const { cache, fetched } = makeCache({ missing: 'gone.flac' });
    const report = await cache.preload(samples(['gone.wav', 'ok.wav'], true));
    expect(report.failed).toBe(1);
    expect(await cache.get('gone.wav')).toBeNull();
    expect(fetched.filter((file) => file === 'gone.flac')).toHaveLength(1);
  });

  it('shares a play that is already loading instead of fetching twice', async () => {
    const { cache, fetched } = makeCache();
    const playing = cache.get('a.wav');
    const report = await cache.preload(samples(['a.wav'], true));
    await playing;
    expect(fetched).toEqual(['a.flac']);
    expect(report.decoded).toBe(0);
  });

  it('stops preloading unpinned wavs at the budget but always loads pinned ones', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 1 });
    const report = await cache.preload([
      ...samples(['click.wav', 'answer.wav', 'hammer.wav'], true),
      ...samples(['talk.wav', 'bed.wav'], false),
    ]);
    expect(fetched).toEqual(['click.flac', 'answer.flac', 'hammer.flac']);
    expect(report.skipped).toBe(2);
    expect(report.pinnedBytes).toBe(3 * CLIP_BYTES);
  });
});

describe('SampleCache preload budget', () => {
  it('stops adding unpinned wavs once a load in flight has evicted one', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 3 });
    const report = await cache.preload(samples(['talk-1.wav', 'talk-2.wav', 'talk-3.wav', 'bed.wav'], false));
    // Three loads start together; the third evicts the first, so the bed is never fetched.
    expect(fetched).toEqual(['talk-1.flac', 'talk-2.flac', 'talk-3.flac']);
    expect(report.skipped).toBe(1);
  });
});

describe('SampleCache budget', () => {
  it('evicts the least recently played unpinned wav, never a pinned one', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 3 });
    await cache.preload(samples(['click.wav'], true));
    await cache.get('talk-1.wav');
    await cache.get('talk-2.wav');
    // Played again, so talk-2 is now the least recently played.
    await cache.get('talk-1.wav');
    await cache.get('bed.wav');
    expect(cache.bytes).toBe(3 * CLIP_BYTES);
    expect(cache.duration('click.wav')).toBe(1);
    expect(cache.duration('talk-1.wav')).toBe(1);
    expect(cache.duration('talk-2.wav')).toBeUndefined();
    await cache.get('talk-2.wav');
    expect(fetched.filter((file) => file === 'talk-2.flac')).toHaveLength(2);
  });

  it('keeps the wav it just decoded even when the pinned set alone fills the budget', async () => {
    const { cache } = makeCache({ budgetClips: 1 });
    await cache.preload(samples(['click.wav', 'fail.wav'], true));
    expect(await cache.get('talk.wav')).not.toBeNull();
    expect(cache.duration('talk.wav')).toBe(1);
    await cache.get('bed.wav');
    expect(cache.duration('talk.wav')).toBeUndefined();
    expect(cache.duration('click.wav')).toBe(1);
  });

  it('pins a wav a play had already decoded', async () => {
    const { cache } = makeCache({ budgetClips: 2 });
    await cache.get('click.wav');
    await cache.preload(samples(['click.wav'], true));
    await cache.get('talk-1.wav');
    await cache.get('talk-2.wav');
    await cache.get('talk-3.wav');
    expect(cache.duration('click.wav')).toBe(1);
  });
});

/** Two banks of two clips each, every span one clip long, both qualities laid out alike. */
function twoBanks(): SoundBanksDocument {
  const span = (slot: number) => ({ offset: slot * CLIP_BYTES_ENCODED, length: CLIP_BYTES_ENCODED });
  const entry = (bank: string, slot: number) => ({
    bank,
    spans: { lossless: span(slot), compact: span(slot) },
  });
  return {
    ...NO_SOUND_BANKS,
    clips: {
      'gui/click.wav': entry('gui-0', 0),
      'gui/fail.wav': entry('gui-0', 1),
      'talk/a.wav': entry('talk-0', 0),
      'talk/b.wav': entry('talk-0', 1),
    },
  };
}
/** An encoded clip's bytes in a test bank: the fake decoder reads one frame per byte. */
const CLIP_BYTES_ENCODED = CLIP_FRAMES * BYTES_PER_FRAME;

describe('SampleCache banks', () => {
  it('preloads each bank with one fetch and decodes every clip from it', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks() });
    const report = await cache.preload(
      samples(['gui/click.wav', 'talk/a.wav', 'gui/fail.wav', 'talk/b.wav'], true),
    );
    expect(fetched).toEqual(['banks/gui-0.lossless.bin', 'banks/talk-0.lossless.bin']);
    expect(report.decoded).toBe(4);
    expect(report.pinnedBytes).toBe(4 * CLIP_BYTES);
  });

  it('fetches the compact copies when asked for that quality', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), quality: 'compact' });
    await cache.preload(samples(['gui/click.wav'], true));
    await cache.get('talk/a.wav');
    expect(fetched).toEqual(['banks/gui-0.compact.bin', 'talk/a.ogg']);
  });

  it('lets go of a bank after the preload, so a later load fetches the clip alone', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), budgetClips: 1 });
    await cache.preload(samples(['talk/a.wav'], false));
    await cache.get('talk/b.wav');
    expect(fetched).toEqual(['banks/talk-0.lossless.bin', 'talk/b.flac']);
  });

  it('loads a clip from its own file when its bank fails to arrive', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), missing: 'banks/gui-0.lossless.bin' });
    const report = await cache.preload(samples(['gui/click.wav'], true));
    expect(fetched).toEqual(['banks/gui-0.lossless.bin', 'gui/click.flac']);
    expect(report.decoded).toBe(1);
  });

  it('stays silent without a bank index', async () => {
    const { cache } = makeCache({ banks: null });
    const report = await cache.preload(samples(['gui/click.wav'], true));
    expect(report.failed).toBe(1);
    expect(await cache.get('talk/a.wav')).toBeNull();
  });
});
