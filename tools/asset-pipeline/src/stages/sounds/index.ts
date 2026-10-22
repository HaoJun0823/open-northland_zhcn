import { readFile, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import {
  SOUND_BANKS_FILE,
  SOUND_BANKS_VERSION,
  SOUND_QUALITIES,
  type SoundBankEntry,
  type SoundBankSpan,
  type SoundBanksDocument,
  type SoundQuality,
  soundBankPath,
  soundClipPath,
} from '@open-northland/data';
import { writeFileWithParents } from '../../files.js';
import { collectSourceFiles, DATA_SOUNDS_DIR, type SourceRoots } from '../../roots.js';
import { SOUNDS_DIR } from '../content-tree.js';
import { ffmpegEncode, SOUND_ENCODINGS, type SoundEncoder } from './encode.js';

const SOUNDS_SOURCE_PREFIX = `${DATA_SOUNDS_DIR.toLowerCase()}/`;

/** A bank closes before its lossless copy passes this size, so one fetch stays short on a slow link
 *  and a few banks still cover the whole tree. */
export const MAX_BANK_BYTES = 4 * 1024 * 1024;

/** The bank of clips filed directly in the sounds root. */
const ROOT_BANK_FOLDER = 'root';

export interface SoundStageReport {
  readonly clips: number;
  readonly banks: number;
  /** Encoded bytes of every clip, per quality. */
  readonly bytes: Readonly<Record<SoundQuality, number>>;
}

interface EncodedClip {
  /** The IR's path for the clip: lower-cased, relative to the sounds root, still ending in `.wav`. */
  readonly file: string;
  readonly encoded: Readonly<Record<SoundQuality, Uint8Array>>;
}

/**
 * Encodes the mod's loose `.wav` tree into `sounds/`: each clip alone in every quality, the same clips
 * packed into per-folder banks, and the `banks.json` index naming each clip's span (see
 * `SoundBanksDocument`). The directory is rebuilt from scratch, so no clip of an earlier run survives.
 */
export async function convertSoundTree(
  roots: SourceRoots,
  outDir: string,
  encode: SoundEncoder = ffmpegEncode,
): Promise<SoundStageReport> {
  const root = join(outDir, SOUNDS_DIR);
  await rm(root, { recursive: true, force: true });
  const sources = await collectSourceFiles(
    roots,
    (rel) => rel.startsWith(SOUNDS_SOURCE_PREFIX) && rel.endsWith('.wav'),
  );
  const clips = await mapConcurrently(sources, availableParallelism(), async ({ rel, path }) => {
    const wav = new Uint8Array(await readFile(path));
    const encoded = { lossless: await encode(wav, 'lossless'), compact: await encode(wav, 'compact') };
    return { file: rel.toLowerCase().slice(SOUNDS_SOURCE_PREFIX.length), encoded };
  });
  const bytes = { lossless: 0, compact: 0 } satisfies Record<SoundQuality, number>;
  for (const clip of clips) {
    for (const quality of SOUND_QUALITIES) {
      const data = clip.encoded[quality];
      bytes[quality] += data.length;
      await writeFileWithParents(
        join(root, soundClipPath(clip.file, SOUND_ENCODINGS[quality].extension)),
        data,
      );
    }
  }
  const index: Record<string, SoundBankEntry> = {};
  const banks = packBanks(clips);
  for (const [bank, members] of banks) {
    const lossless = await writeBank(root, bank, members, 'lossless');
    const compact = await writeBank(root, bank, members, 'compact');
    for (const [i, clip] of members.entries()) {
      const losslessSpan = lossless[i];
      const compactSpan = compact[i];
      if (losslessSpan === undefined || compactSpan === undefined)
        throw new Error(`bank ${bank} lost a span`);
      index[clip.file] = { bank, spans: { lossless: losslessSpan, compact: compactSpan } };
    }
  }
  const document: SoundBanksDocument = {
    version: SOUND_BANKS_VERSION,
    extensions: { lossless: SOUND_ENCODINGS.lossless.extension, compact: SOUND_ENCODINGS.compact.extension },
    clips: index,
  };
  await writeFileWithParents(join(root, SOUND_BANKS_FILE), `${JSON.stringify(document)}\n`);
  return { clips: clips.length, banks: banks.size, bytes };
}

/** Writes `members` back to back as `bank`'s copy in `quality`; the span of each, in order. */
async function writeBank(
  root: string,
  bank: string,
  members: readonly EncodedClip[],
  quality: SoundQuality,
): Promise<SoundBankSpan[]> {
  const packed = new Uint8Array(members.reduce((sum, clip) => sum + clip.encoded[quality].length, 0));
  const spans: SoundBankSpan[] = [];
  let offset = 0;
  for (const clip of members) {
    const data = clip.encoded[quality];
    packed.set(data, offset);
    spans.push({ offset, length: data.length });
    offset += data.length;
  }
  await writeFileWithParents(join(root, soundBankPath(bank, quality)), packed);
  return spans;
}

/** Clips grouped by folder (a voice folder's tribe subfolder on its own), in path order, each folder
 *  split into numbered banks of at most {@link MAX_BANK_BYTES} lossless bytes. */
function packBanks(clips: readonly EncodedClip[]): Map<string, EncodedClip[]> {
  const byFolder = new Map<string, EncodedClip[]>();
  for (const clip of clips) {
    const slash = clip.file.lastIndexOf('/');
    const folder = slash < 0 ? ROOT_BANK_FOLDER : clip.file.slice(0, slash).replaceAll('/', '-');
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), clip]);
  }
  const banks = new Map<string, EncodedClip[]>();
  for (const [folder, members] of byFolder) {
    let current: EncodedClip[] = [];
    let size = 0;
    let count = 0;
    const close = (): void => {
      if (current.length > 0) banks.set(`${folder}-${count++}`, current);
      current = [];
      size = 0;
    };
    for (const clip of members) {
      const length = clip.encoded.lossless.length;
      if (size > 0 && size + length > MAX_BANK_BYTES) close();
      current.push(clip);
      size += length;
    }
    close();
  }
  return banks;
}

/** `work` over `items` with at most `limit` running at once, results in input order. */
async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i];
      if (item !== undefined) results[i] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
