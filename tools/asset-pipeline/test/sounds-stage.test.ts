import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SoundBanksDocument, type SoundQuality } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statIfExists, writeFileWithParents } from '../src/files.js';
import { FFMPEG, ffmpegEncode, flacStreamInfoOnly } from '../src/stages/sounds/encode.js';
import { convertSoundTree, MAX_BANK_BYTES } from '../src/stages/sounds/index.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

/** Stands in for ffmpeg: each quality's bytes are the source bytes behind a one-byte quality tag. */
const QUALITY_TAG: Readonly<Record<SoundQuality, number>> = { lossless: 0xf1, compact: 0x0c };
const tagged = async (wav: Uint8Array, quality: SoundQuality): Promise<Uint8Array> => {
  const out = new Uint8Array(wav.length + 1);
  out[0] = QUALITY_TAG[quality];
  out.set(wav, 1);
  return out;
};

async function readIndex(out: string): Promise<SoundBanksDocument> {
  return SoundBanksDocument.parse(JSON.parse(await readFile(join(out, 'sounds', 'banks.json'), 'utf8')));
}

describe('convertSoundTree', () => {
  let temp: GameOutTemp;

  beforeEach(async () => {
    temp = await makeGameOutTemp('sounds');
  });

  afterEach(() => temp.cleanup());

  it('encodes each clip in every quality at the lower-cased path the IR references', async () => {
    await temp.write('Data/Engine2D/bin/Sounds/Static/Axe01.WAV', Uint8Array.of(1));
    await temp.write('data/engine2d/bin/sounds/gui/click_confirm.wav', Uint8Array.of(2));
    const report = await convertSoundTree({ data: temp.game }, temp.out, tagged);
    expect(report).toMatchObject({ clips: 2, banks: 2, bytes: { lossless: 4, compact: 4 } });
    expect([...(await readFile(join(temp.out, 'sounds/static/axe01.flac')))]).toEqual([
      QUALITY_TAG.lossless,
      1,
    ]);
    expect([...(await readFile(join(temp.out, 'sounds/static/axe01.ogg')))]).toEqual([
      QUALITY_TAG.compact,
      1,
    ]);
    expect(Object.keys((await readIndex(temp.out)).clips).sort()).toEqual([
      'gui/click_confirm.wav',
      'static/axe01.wav',
    ]);
  });

  it('packs a folder into one bank per quality and indexes each clip span', async () => {
    await temp.write('data/engine2d/bin/sounds/humantalk/a.wav', Uint8Array.of(1, 1));
    await temp.write('data/engine2d/bin/sounds/humantalk/b.wav', Uint8Array.of(2, 2, 2));
    await temp.write('data/engine2d/bin/sounds/humantalk/latin/c.wav', Uint8Array.of(3));
    await convertSoundTree({ data: temp.game }, temp.out, tagged);
    const index = await readIndex(temp.out);
    expect(index.extensions).toEqual({ lossless: 'flac', compact: 'ogg' });
    expect(index.clips['humantalk/b.wav']).toEqual({
      bank: 'humantalk-0',
      spans: { lossless: { offset: 3, length: 4 }, compact: { offset: 3, length: 4 } },
    });
    expect(index.clips['humantalk/latin/c.wav']?.bank).toBe('humantalk-latin-0');
    const bank = await readFile(join(temp.out, 'sounds/banks/humantalk-0.compact.bin'));
    expect([...bank]).toEqual([QUALITY_TAG.compact, 1, 1, QUALITY_TAG.compact, 2, 2, 2]);
  });

  it('opens a new bank before one would pass the size cap', async () => {
    const half = new Uint8Array(MAX_BANK_BYTES / 2);
    for (const name of ['a', 'b', 'c'])
      await temp.write(`data/engine2d/bin/sounds/ambient/${name}.wav`, half);
    const report = await convertSoundTree({ data: temp.game }, temp.out, tagged);
    const index = await readIndex(temp.out);
    expect(report.banks).toBe(3);
    expect(['a', 'b', 'c'].map((name) => index.clips[`ambient/${name}.wav`]?.bank)).toEqual([
      'ambient-0',
      'ambient-1',
      'ambient-2',
    ]);
  });

  it('leaves wavs outside the sounds tree alone and clears an earlier run', async () => {
    await temp.write('maps/community/some_map/briefing.wav', Uint8Array.of(1));
    await temp.write('Data/engine2d/bin/sounds/soundfx.cif', Uint8Array.of(1));
    await temp.write('Data/engine2d/bin/sounds/misc/thunder.wav', Uint8Array.of(1));
    await writeFileWithParents(join(temp.out, 'sounds/misc/thunder.wav'), Uint8Array.of(9));
    const report = await convertSoundTree({ data: temp.game }, temp.out, tagged);
    expect(report.clips).toBe(1);
    expect(await statIfExists(join(temp.out, 'sounds/misc/thunder.wav'))).toBeUndefined();
    expect(await statIfExists(join(temp.out, 'maps/community/some_map/briefing.flac'))).toBeUndefined();
  });
});

describe('flacStreamInfoOnly', () => {
  /** `fLaC`, then STREAMINFO (34 bytes), a 2-byte comment and the last block, 3 bytes of padding. */
  function flacWithTags(): Uint8Array {
    const streamInfo = [0x00, 0, 0, 34, ...new Array<number>(34).fill(7)];
    const comment = [0x04, 0, 0, 2, 0xaa, 0xbb];
    const padding = [0x81, 0, 0, 3, 0, 0, 0];
    return Uint8Array.of(0x66, 0x4c, 0x61, 0x43, ...streamInfo, ...comment, ...padding, 0xff, 0xf8);
  }

  it('keeps the marker, STREAMINFO as the last block and the audio frames', () => {
    const out = flacStreamInfoOnly(flacWithTags());
    expect(out.length).toBe(4 + 4 + 34 + 2);
    expect(out[4]).toBe(0x80);
    expect([...out.subarray(-2)]).toEqual([0xff, 0xf8]);
  });

  it('rejects a file that is no FLAC', () => {
    expect(() => flacStreamInfoOnly(Uint8Array.of(1, 2, 3, 4))).toThrow(/marker/);
  });
});

function ffmpegPresent(): boolean {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A 16-bit mono PCM wav of `samples`, as the mod ships its clips. */
function pcmWav(samples: readonly number[], sampleRate: number): Uint8Array {
  const data = new DataView(new ArrayBuffer(samples.length * 2));
  for (const [i, sample] of samples.entries()) data.setInt16(i * 2, sample, true);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, text: string): void => {
    for (const [i, char] of [...text].entries()) header.setUint8(at + i, char.charCodeAt(0));
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + data.byteLength, true);
  ascii(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, 'data');
  header.setUint32(40, data.byteLength, true);
  return Uint8Array.from([...new Uint8Array(header.buffer), ...new Uint8Array(data.buffer)]);
}

describe.runIf(ffmpegPresent())('ffmpegEncode', () => {
  const SAMPLE_RATE = 22050;
  const TONE_HZ = 440;
  const AMPLITUDE = 8000;
  const samples = Array.from({ length: SAMPLE_RATE / 4 }, (_, i) =>
    Math.round(AMPLITUDE * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE)),
  );

  it('round-trips the lossless copy bit for bit and serves it without tags', async () => {
    const wav = pcmWav(samples, SAMPLE_RATE);
    const flac = await ffmpegEncode(wav, 'lossless');
    expect(flac[4]).toBe(0x80); // STREAMINFO is the only metadata block
    const decoded = execFileSync(FFMPEG, ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', 'pipe:1'], {
      input: flac,
    });
    expect(Buffer.compare(decoded, Buffer.from(wav.subarray(44)))).toBe(0);
  });

  it('writes the compact copy as Ogg Opus', async () => {
    const opus = await ffmpegEncode(pcmWav(samples, SAMPLE_RATE), 'compact');
    expect(new TextDecoder().decode(opus.subarray(0, 4))).toBe('OggS');
    expect(new TextDecoder().decode(opus.subarray(28, 36))).toBe('OpusHead');
  });
});
