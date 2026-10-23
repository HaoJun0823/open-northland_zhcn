import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SOUND_BANKS_FILE,
  SOUND_BANKS_VERSION,
  SOUND_EXTENSIONS,
  SOUND_QUALITIES,
  type SoundBank,
  type SoundBankSpan,
  type SoundBanksDocument,
  type SoundQuality,
  servedEncoding,
  soundBankPath,
  soundClipPath,
} from '@open-northland/data';
import { writeFileWithParents } from '../../files.js';
import {
  collectSourceFiles,
  DATA_ATTACK_ALERTS_DIR,
  DATA_SOUNDS_DIR,
  type SourceRoots,
} from '../../roots.js';
import { SOUNDS_DIR } from '../content-tree.js';
import { encodeSound, type SoundEncoder } from './encode.js';

const SOUNDS_SOURCE_PREFIX = `${DATA_SOUNDS_DIR.toLowerCase()}/`;
const ATTACK_ALERTS_SOURCE_PREFIX = `${DATA_ATTACK_ALERTS_DIR}/`;

/** A bank closes before its lossless copy passes this size, so one fetch stays short on a slow link
 *  and a few banks still cover the whole tree. */
export const MAX_BANK_BYTES = 4 * 1024 * 1024;

/** The bank of clips filed directly in the sounds root. */
const ROOT_BANK_FOLDER = 'root';

export interface SoundStageReport {
  readonly clips: number;
  readonly banks: number;
  /** Bytes every clip is served with, per quality. */
  readonly bytes: Readonly<Record<SoundQuality, number>>;
}

interface EncodedClip {
  /** The IR's path for the clip: lower-cased, relative to the sounds root, still ending in `.wav`. */
  readonly file: string;
  readonly encoded: Readonly<Record<SoundQuality, Uint8Array>>;
}

/** The clips a terrain bed loops: every wav of an ambient that covers pattern groups. These stay
 *  lossless in every quality (see `encodeSound`). */
export function loopedBedClips(sounds: SoundBank): Set<string> {
  return new Set(
    sounds.ambient.filter((a) => a.patternGroups.length > 0).flatMap((a) => a.sfx.map((s) => s.file)),
  );
}

/**
 * Encodes the mod's loose `.wav` tree, and the pack's attack alert takes under `attack-alerts/`, into
 * `sounds/`: each clip alone in every encoding, the same clips
 * packed into per-folder banks per quality, and the `banks.json` index naming each clip's span (see
 * `SoundBanksDocument`). A clip in `losslessOnly` fills its compact span with its lossless bytes. The
 * directory is rebuilt from scratch, so no clip of an earlier run survives.
 */
export async function convertSoundTree(
  roots: SourceRoots,
  outDir: string,
  losslessOnly: ReadonlySet<string>,
  encode: SoundEncoder = encodeSound,
): Promise<SoundStageReport> {
  const root = join(outDir, SOUNDS_DIR);
  await rm(root, { recursive: true, force: true });
  const sources = await collectSourceFiles(
    roots,
    (rel) =>
      (rel.startsWith(SOUNDS_SOURCE_PREFIX) || rel.startsWith(ATTACK_ALERTS_SOURCE_PREFIX)) &&
      rel.endsWith('.wav'),
  );
  // The encoders run synchronously on this thread, so clips encode one after another.
  const clips: EncodedClip[] = [];
  for (const { rel, path } of sources) {
    const wav = new Uint8Array(await readFile(path));
    const encoded = { lossless: await encode(wav, 'lossless'), compact: await encode(wav, 'compact') };
    const lower = rel.toLowerCase();
    const file = lower.startsWith(SOUNDS_SOURCE_PREFIX) ? lower.slice(SOUNDS_SOURCE_PREFIX.length) : lower;
    clips.push({ file, encoded });
  }
  const document: SoundBanksDocument = {
    version: SOUND_BANKS_VERSION,
    losslessOnly: clips.map((clip) => clip.file).filter((file) => losslessOnly.has(file)),
    clips: {},
  };
  const bytes = { lossless: 0, compact: 0 } satisfies Record<SoundQuality, number>;
  for (const clip of clips) {
    for (const quality of SOUND_QUALITIES) {
      bytes[quality] += clip.encoded[servedEncoding(document, clip.file, quality)].length;
      await writeFileWithParents(
        join(root, soundClipPath(clip.file, SOUND_EXTENSIONS[quality])),
        clip.encoded[quality],
      );
    }
  }
  const banks = packBanks(clips);
  for (const [bank, members] of banks) {
    const lossless = await writeBank(root, bank, members, 'lossless', document);
    const compact = await writeBank(root, bank, members, 'compact', document);
    for (const [i, clip] of members.entries()) {
      const losslessSpan = lossless[i];
      const compactSpan = compact[i];
      if (losslessSpan === undefined || compactSpan === undefined)
        throw new Error(`bank ${bank} lost a span`);
      document.clips[clip.file] = { bank, spans: { lossless: losslessSpan, compact: compactSpan } };
    }
  }
  await writeFileWithParents(join(root, SOUND_BANKS_FILE), `${JSON.stringify(document)}\n`);
  return { clips: clips.length, banks: banks.size, bytes };
}

/** Writes `members` back to back as `bank`'s copy in `quality`, each in the encoding `index` serves it
 *  in; the span of each, in order. */
async function writeBank(
  root: string,
  bank: string,
  members: readonly EncodedClip[],
  quality: SoundQuality,
  index: SoundBanksDocument,
): Promise<SoundBankSpan[]> {
  const served = members.map((clip) => clip.encoded[servedEncoding(index, clip.file, quality)]);
  const packed = new Uint8Array(served.reduce((sum, data) => sum + data.length, 0));
  const spans: SoundBankSpan[] = [];
  let offset = 0;
  for (const data of served) {
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
