import {
  SOUND_BANKS_FILE,
  type SoundBankEntry,
  SoundBanksDocument,
  type SoundQuality,
  soundBankPath,
  soundClipPath,
} from '@open-northland/data';
import type { FetchBytes } from '../platform.js';

/** Decoded PCM is float32: each sample frame costs this many bytes per channel. */
export const DECODED_BYTES_PER_SAMPLE = 4;

/**
 * The most decoded audio the cache keeps, in bytes. The whole bank decodes to about 240 MB at a
 * 48 kHz context, so past this the least recently played unpinned clip goes first. Approximation: room
 * for the pinned tiers (about 80 MB at 48 kHz) plus a working set of talk and beds.
 */
export const SAMPLE_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

/**
 * Clips a preload decodes at once. A bank's clips are already in memory, so a decode waits on no
 * fetch; under a loaded game frame the decoder and each decode's main-thread resumption are the limit.
 * Measured headless on a running map: more in flight barely shortens the preload and lets it overshoot
 * the budget check by the clips already decoding.
 */
export const PRELOAD_CONCURRENCY = 16;

/** The encoding a cache fetches when its owner names none: the source PCM unchanged. */
export const DEFAULT_SOUND_QUALITY: SoundQuality = 'lossless';

/** One clip a preload loads, and whether the cache keeps it for good. */
export interface PreloadSample {
  readonly file: string;
  readonly pinned: boolean;
}

/** What a finished preload left in the cache. */
export interface SamplePreloadReport {
  /** Clips the preload decoded itself (a clip already cached or loading counts as neither). */
  readonly decoded: number;
  /** Clips whose fetch or decode failed. */
  readonly failed: number;
  /** Unpinned clips left out because the cache had reached its budget. */
  readonly skipped: number;
  /** Decoded bytes the cache holds now, pinned and unpinned. */
  readonly cachedBytes: number;
  /** Of {@link cachedBytes}, the bytes that are never evicted. */
  readonly pinnedBytes: number;
}

export interface SampleCacheOptions {
  /** Default {@link SAMPLE_CACHE_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
  /** Default {@link PRELOAD_CONCURRENCY}. */
  readonly concurrency?: number;
  /** Which encoding of each clip and bank to fetch. Default {@link DEFAULT_SOUND_QUALITY}. */
  readonly quality?: SoundQuality;
}

/** A decoded buffer's memory: length x channels x {@link DECODED_BYTES_PER_SAMPLE}. */
export function decodedBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * DECODED_BYTES_PER_SAMPLE;
}

/**
 * The fetch+decode cache for sound clips, keyed by the IR's clip path: each clip is loaded and decoded
 * at most once while cached, concurrent requests share the in-flight promise, and a failure is memoised
 * as null so a missing clip never spams the network. A preload fetches whole banks (`banks.json`) and
 * decodes their clips from memory; any other load fetches the clip's own file. Decoding on the playing
 * context resamples each clip to its rate once. Past the byte budget the least recently played
 * unpinned clip is dropped and loads again on its next play. Owned by the engine (decoding needs its
 * `AudioContext`).
 */
export class SampleCache {
  /** file → decoded buffer (or an in-flight promise; a null result means load failed - don't retry). */
  private readonly entries = new Map<string, AudioBuffer | null | Promise<AudioBuffer | null>>();
  /** Decoded unpinned files → their bytes, least recently played first. */
  private readonly evictable = new Map<string, number>();
  private readonly pinned = new Set<string>();
  private cached = 0;
  private pinnedCached = 0;
  /** Clips dropped for the budget so far; a preload stops adding unpinned ones once this moves. */
  private evictions = 0;
  private readonly budgetBytes: number;
  private readonly concurrency: number;
  private readonly quality: SoundQuality;
  /** The bank index, fetched as the cache is made so the first play finds it; null when the tree
   *  serves none or it is invalid. */
  private readonly banks: Promise<SoundBanksDocument | null>;
  /** Bank bytes a running preload holds, by bank name, until its last planned clip has loaded. */
  private readonly heldBanks = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    /** URL prefix the sound tree is served under (a clip or bank path is appended). */
    private readonly baseUrl: string,
    private readonly fetchBytes: FetchBytes,
    /** Decode encoded clip bytes into a playable buffer (the context's `decodeAudioData`). */
    private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
    options: SampleCacheOptions = {},
  ) {
    this.budgetBytes = options.budgetBytes ?? SAMPLE_CACHE_BUDGET_BYTES;
    this.concurrency = options.concurrency ?? PRELOAD_CONCURRENCY;
    this.quality = options.quality ?? DEFAULT_SOUND_QUALITY;
    this.banks = this.fetchBankIndex();
  }

  /** Decoded bytes held now. */
  get bytes(): number {
    return this.cached;
  }

  /** The decoded buffer for `file`, fetched on first use; null once its load has ever failed. A play
   *  marks the clip as the most recently used. */
  get(file: string): Promise<AudioBuffer | null> {
    const size = this.evictable.get(file);
    if (size !== undefined) {
      this.evictable.delete(file);
      this.evictable.set(file, size);
    }
    return this.load(file);
  }

  /** The decoded length of `file` in seconds, or undefined while it is unloaded, loading or failed. */
  duration(file: string): number | undefined {
    const entry = this.entries.get(file);
    return entry === undefined || entry === null || entry instanceof Promise ? undefined : entry.duration;
  }

  /**
   * Load `samples` in order, {@link SampleCacheOptions.concurrency} at a time, each from its bank: a
   * bank is fetched once, when its first planned clip comes up, and released after its last. Pinned
   * clips always load and stay; unpinned ones stop once the cache reaches its budget or first evicts,
   * so a preload never churns through what it just decoded. Once `stopped` answers true no worker
   * starts another clip; loads already in flight still land.
   */
  async preload(
    samples: readonly PreloadSample[],
    stopped: () => boolean = () => false,
  ): Promise<SamplePreloadReport> {
    const banks = await this.banks;
    const bankOf = (file: string): SoundBankEntry | undefined => banks?.clips[file];
    const planned = new Map<string, number>();
    for (const { file } of samples) {
      const bank = bankOf(file)?.bank;
      if (bank !== undefined) planned.set(bank, (planned.get(bank) ?? 0) + 1);
    }
    const done = (file: string): void => {
      const bank = bankOf(file)?.bank;
      if (bank === undefined) return;
      const left = (planned.get(bank) ?? 0) - 1;
      planned.set(bank, left);
      if (left <= 0) this.heldBanks.delete(bank);
    };
    const evictionsBefore = this.evictions;
    const full = (): boolean => this.cached >= this.budgetBytes || this.evictions !== evictionsBefore;
    let next = 0;
    let decoded = 0;
    let failed = 0;
    let skipped = 0;
    const loadSample = async (sample: PreloadSample): Promise<void> => {
      if (sample.pinned) this.pin(sample.file);
      if (this.entries.has(sample.file)) return;
      if (!sample.pinned && full()) {
        skipped++;
        return;
      }
      const entry = bankOf(sample.file);
      if (entry !== undefined && !this.heldBanks.has(entry.bank)) this.holdBank(entry.bank);
      if ((await this.load(sample.file)) === null) failed++;
      else decoded++;
    };
    const worker = async (): Promise<void> => {
      for (let i = next++; i < samples.length && !stopped(); i = next++) {
        const sample = samples[i];
        if (sample === undefined) continue;
        await loadSample(sample);
        done(sample.file);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.max(1, this.concurrency) }, worker));
    } finally {
      this.heldBanks.clear();
    }
    return { decoded, failed, skipped, cachedBytes: this.cached, pinnedBytes: this.pinnedCached };
  }

  /** Keep `file` for good; a clip already decoded leaves the eviction order. */
  private pin(file: string): void {
    if (this.pinned.has(file)) return;
    this.pinned.add(file);
    const size = this.evictable.get(file);
    if (size === undefined) return;
    this.evictable.delete(file);
    this.pinnedCached += size;
  }

  private load(file: string): Promise<AudioBuffer | null> {
    const cached = this.entries.get(file);
    if (cached !== undefined) return Promise.resolve(cached); // a buffer, a cached-null failure, or an in-flight promise
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const buffer = await this.decode(await this.clipBytes(file));
        this.store(file, buffer);
        return buffer;
      } catch {
        this.entries.set(file, null); // remember the failure - don't re-fetch
        return null;
      }
    })();
    this.entries.set(file, promise);
    return promise;
  }

  private holdBank(bank: string): void {
    const bytes = this.fetchBytes(this.baseUrl + soundBankPath(bank, this.quality));
    // A failed bank is answered clip by clip; no loader may be left awaiting it unobserved.
    bytes.catch(() => undefined);
    this.heldBanks.set(bank, bytes);
  }

  private async fetchBankIndex(): Promise<SoundBanksDocument | null> {
    try {
      const bytes = await this.fetchBytes(this.baseUrl + SOUND_BANKS_FILE);
      const parsed = SoundBanksDocument.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** `file`'s encoded bytes: a copy of its span when a preload holds its bank, else its own file. A
   *  bank that failed to arrive falls back to the clip's file. */
  private async clipBytes(file: string): Promise<ArrayBuffer> {
    const banks = await this.banks;
    if (banks === null) throw new Error('no sound bank index');
    const entry = banks.clips[file];
    const bank = entry === undefined ? undefined : this.heldBanks.get(entry.bank);
    if (entry !== undefined && bank !== undefined) {
      const span = entry.spans[this.quality];
      try {
        // A copy: decoding detaches the buffer it is given, and the bank serves the clips after it.
        return (await bank).slice(span.offset, span.offset + span.length);
      } catch {
        // The bank's fetch failed; the clip's own file may still load.
      }
    }
    return this.fetchBytes(this.baseUrl + soundClipPath(file, banks.extensions[this.quality]));
  }

  private store(file: string, buffer: AudioBuffer): void {
    this.entries.set(file, buffer);
    const size = decodedBytes(buffer);
    this.cached += size;
    if (this.pinned.has(file)) {
      this.pinnedCached += size;
      return;
    }
    this.evictable.set(file, size);
    // The newest stays even over budget: its caller is about to play it.
    while (this.cached > this.budgetBytes && this.evictable.size > 1) {
      const oldest = this.evictable.keys().next().value;
      if (oldest === undefined) break;
      this.cached -= this.evictable.get(oldest) ?? 0;
      this.evictable.delete(oldest);
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}
