import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SOUND_EXTENSIONS, type SoundQuality } from '@open-northland/data';

const run = promisify(execFile);

/** The ffmpeg the stage runs: `ON_FFMPEG` when set, else the one on `PATH`. */
export const FFMPEG = process.env.ON_FFMPEG ?? 'ffmpeg';

/** How one quality is encoded: the served extension and ffmpeg's output arguments. */
export interface SoundEncoding {
  readonly extension: string;
  readonly ffmpegArgs: readonly string[];
}

/**
 * Opus bit rate for the compact copy. The source clips are 22.05 kHz mono, so they carry nothing above
 * 11 kHz; the Opus project's recommended settings place mono music at 48 kbit/s and above as
 * transparent for most listeners, and speech needs less.
 */
const COMPACT_OPUS_BITRATE = '48k';
/** ffmpeg's highest FLAC effort: the smallest lossless output, at an encode cost the stage can afford. */
const LOSSLESS_FLAC_LEVEL = '12';

/**
 * The codec each served quality uses; the extension is `SOUND_EXTENSIONS`, which the client reads too.
 * `.ogg` rather than `.opus` keeps the compact copy on an extension CDNs and servers already treat as
 * cacheable audio.
 *
 * A looped terrain bed stays FLAC in the compact quality as well (the index's `losslessOnly`). Measured
 * in headless Chromium on `ambient/meadow2`, `water3` and `beach2`: at a 22.05 kHz context the Opus
 * decode has the wav's frame count, but at a 48 kHz context it runs 2 frames longer than the resampled
 * wav or FLAC (735318 vs 735316 for meadow2), so the loop period would drift from the source's.
 */
export const SOUND_ENCODINGS: Readonly<Record<SoundQuality, SoundEncoding>> = {
  lossless: {
    extension: SOUND_EXTENSIONS.lossless,
    ffmpegArgs: ['-c:a', 'flac', '-compression_level', LOSSLESS_FLAC_LEVEL, '-f', 'flac'],
  },
  compact: {
    extension: SOUND_EXTENSIONS.compact,
    ffmpegArgs: ['-c:a', 'libopus', '-b:a', COMPACT_OPUS_BITRATE, '-application', 'audio', '-f', 'ogg'],
  },
};

/** Turns one source wav into one quality's bytes. */
export type SoundEncoder = (wav: Uint8Array, quality: SoundQuality) => Promise<Uint8Array>;

/** Encode through ffmpeg via temporary files: the FLAC muxer completes its stream header (length and
 *  MD5) only on seekable output. `bitexact` keeps the encoder's version string out of the bytes. */
export async function ffmpegEncode(wav: Uint8Array, quality: SoundQuality): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'on-sound-'));
  try {
    const input = join(dir, 'in.wav');
    const output = join(dir, `out.${SOUND_ENCODINGS[quality].extension}`);
    await writeFile(input, wav);
    await run(FFMPEG, [
      '-nostdin',
      '-v',
      'error',
      '-i',
      input,
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      ...SOUND_ENCODINGS[quality].ffmpegArgs,
      output,
    ]);
    const bytes = new Uint8Array(await readFile(output));
    return quality === 'lossless' ? flacStreamInfoOnly(bytes) : bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const FLAC_MARKER = 'fLaC';
const FLAC_MARKER_BYTES = 4;
const METADATA_HEADER_BYTES = 4;
const LAST_BLOCK_FLAG = 0x80;
const STREAMINFO_TYPE = 0;

/**
 * The FLAC file with only its STREAMINFO block: ffmpeg also writes a Vorbis comment and 8 KiB of
 * padding for later tag edits, which a served clip never needs (RFC 9639 metadata block layout).
 */
export function flacStreamInfoOnly(bytes: Uint8Array): Uint8Array {
  if (new TextDecoder().decode(bytes.subarray(0, FLAC_MARKER_BYTES)) !== FLAC_MARKER)
    throw new Error('flac: missing stream marker');
  let at = FLAC_MARKER_BYTES;
  let streamInfo: Uint8Array | null = null;
  for (let last = false; !last; ) {
    const header = bytes[at];
    if (header === undefined || at + METADATA_HEADER_BYTES > bytes.length)
      throw new Error('flac: truncated metadata');
    last = (header & LAST_BLOCK_FLAG) !== 0;
    const length = ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const end = at + METADATA_HEADER_BYTES + length;
    if ((header & ~LAST_BLOCK_FLAG) === STREAMINFO_TYPE) streamInfo = bytes.slice(at, end);
    at = end;
  }
  if (streamInfo === null) throw new Error('flac: no STREAMINFO block');
  streamInfo[0] = LAST_BLOCK_FLAG | STREAMINFO_TYPE;
  const audio = bytes.subarray(at);
  const out = new Uint8Array(FLAC_MARKER_BYTES + streamInfo.length + audio.length);
  out.set(bytes.subarray(0, FLAC_MARKER_BYTES));
  out.set(streamInfo, FLAC_MARKER_BYTES);
  out.set(audio, FLAC_MARKER_BYTES + streamInfo.length);
  return out;
}
