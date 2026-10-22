import { z } from 'zod';

/** Layout version of the sound stage's `sounds/banks.json`. A reader accepts only this one. */
export const SOUND_BANKS_VERSION = 2 as const;

/** The served bank index, relative to the sounds root. */
export const SOUND_BANKS_FILE = 'banks.json';

/** The encodings every sound is served in: `lossless` keeps the source PCM bit for bit, `compact`
 *  trades it for a fraction of the bytes. */
export const SOUND_QUALITIES = ['lossless', 'compact'] as const;
export const SoundQuality = z.enum(SOUND_QUALITIES);
export type SoundQuality = z.infer<typeof SoundQuality>;

/** The file extension each quality's encoding is served with: FLAC for `lossless`, Ogg Opus for
 *  `compact`. A client without the bank index still finds a clip's own file through it. */
export const SOUND_EXTENSIONS: Readonly<Record<SoundQuality, string>> = { lossless: 'flac', compact: 'ogg' };

/** One encoded clip's bytes inside its bank file. */
const BankSpan = z.strictObject({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});
export type SoundBankSpan = z.infer<typeof BankSpan>;

/** Where one clip sits in each quality's copy of its bank. */
export const SoundBankEntry = z.strictObject({
  bank: z.string().min(1),
  spans: z.record(SoundQuality, BankSpan),
});
export type SoundBankEntry = z.infer<typeof SoundBankEntry>;

/**
 * The bank index. Every clip is served alone in each encoding, at its IR path with the encoding's
 * extension in place of `.wav` ({@link soundClipPath}), and in each quality as a span of a bank file
 * that concatenates a folder's clips ({@link soundBankPath}), so a preload fetches a few banks instead
 * of every clip.
 */
export const SoundBanksDocument = z.strictObject({
  version: z.literal(SOUND_BANKS_VERSION),
  /** Clips every quality serves in the lossless encoding (looped beds, whose decoded length must match
   *  the source's), by the IR's clip path. */
  losslessOnly: z.array(z.string()),
  /** Keyed by the IR's clip path (`humantalk/f1ok01.wav`). */
  clips: z.record(z.string(), SoundBankEntry),
});
export type SoundBanksDocument = z.infer<typeof SoundBanksDocument>;

/** The IR names clips by their source `.wav` path; the served copies swap only the extension. */
const SOURCE_EXTENSION = /\.wav$/;

/** The served path, under the sounds root, of `file` alone in the encoding with `extension`. */
export function soundClipPath(file: string, extension: string): string {
  return SOURCE_EXTENSION.test(file)
    ? file.replace(SOURCE_EXTENSION, `.${extension}`)
    : `${file}.${extension}`;
}

/** The encoding `quality` serves `file` in: lossless for a clip the index names lossless-only. Without
 *  an index every clip is served in its quality's own encoding. */
export function servedEncoding(
  index: SoundBanksDocument | null,
  file: string,
  quality: SoundQuality,
): SoundQuality {
  return index?.losslessOnly.includes(file) === true ? 'lossless' : quality;
}

/** The served path, under the sounds root, of `bank`'s copy in `quality`. */
export function soundBankPath(bank: string, quality: SoundQuality): string {
  return `banks/${bank}.${quality}.bin`;
}
