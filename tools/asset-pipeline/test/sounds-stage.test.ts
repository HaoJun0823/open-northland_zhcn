import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Decoder } from '@evan/opus/wasm/index.mjs';
import { emptySoundBank, SoundBanksDocument, type SoundQuality } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeFlac } from '../../../packages/formats/test/support/flac-decode.js';
import { statIfExists, writeFileWithParents } from '../src/files.js';
import { encodeSound } from '../src/stages/sounds/encode.js';
import { convertSoundTree, loopedBedClips, MAX_BANK_BYTES } from '../src/stages/sounds/index.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

/** Stands in for the encoders: each quality's bytes are the source bytes behind a one-byte quality tag. */
const QUALITY_TAG: Readonly<Record<SoundQuality, number>> = { lossless: 0xf1, compact: 0x0c };
const tagged = async (wav: Uint8Array, quality: SoundQuality): Promise<Uint8Array> => {
  const out = new Uint8Array(wav.length + 1);
  out[0] = QUALITY_TAG[quality];
  out.set(wav, 1);
  return out;
};

const NO_LOOPS: ReadonlySet<string> = new Set();

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
    const report = await convertSoundTree({ data: temp.game }, temp.out, NO_LOOPS, tagged);
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
    await convertSoundTree({ data: temp.game }, temp.out, NO_LOOPS, tagged);
    const index = await readIndex(temp.out);
    expect(index.losslessOnly).toEqual([]);
    expect(index.clips['humantalk/b.wav']).toEqual({
      bank: 'humantalk-0',
      spans: { lossless: { offset: 3, length: 4 }, compact: { offset: 3, length: 4 } },
    });
    expect(index.clips['humantalk/latin/c.wav']?.bank).toBe('humantalk-latin-0');
    const bank = await readFile(join(temp.out, 'sounds/banks/humantalk-0.compact.bin'));
    expect([...bank]).toEqual([QUALITY_TAG.compact, 1, 1, QUALITY_TAG.compact, 2, 2, 2]);
  });

  it('fills a looped bed compact span with its lossless bytes but still writes its Opus file', async () => {
    await temp.write('data/engine2d/bin/sounds/ambient/meadow1.wav', Uint8Array.of(1));
    await temp.write('data/engine2d/bin/sounds/ambient/bird_01.wav', Uint8Array.of(2));
    const beds = loopedBedClips({
      ...emptySoundBank(),
      ambient: [
        {
          name: 'Meadow Green',
          patternGroups: ['meadow green'],
          landscapeGroups: [],
          sfx: [{ file: 'ambient/meadow1.wav', params: [] }],
        },
        {
          name: 'All Trees',
          patternGroups: [],
          landscapeGroups: ['trees'],
          sfx: [{ file: 'ambient/bird_01.wav', params: [] }],
        },
      ],
    });
    const report = await convertSoundTree({ data: temp.game }, temp.out, beds, tagged);
    expect((await readIndex(temp.out)).losslessOnly).toEqual(['ambient/meadow1.wav']);
    const bank = await readFile(join(temp.out, 'sounds/banks/ambient-0.compact.bin'));
    expect([...bank]).toEqual([QUALITY_TAG.compact, 2, QUALITY_TAG.lossless, 1]);
    expect([...(await readFile(join(temp.out, 'sounds/ambient/meadow1.ogg')))]).toEqual([
      QUALITY_TAG.compact,
      1,
    ]);
    expect(report.bytes).toEqual({ lossless: 4, compact: 4 });
  });

  it('opens a new bank before one would pass the size cap', async () => {
    const half = new Uint8Array(MAX_BANK_BYTES / 2);
    for (const name of ['a', 'b', 'c'])
      await temp.write(`data/engine2d/bin/sounds/ambient/${name}.wav`, half);
    const report = await convertSoundTree({ data: temp.game }, temp.out, NO_LOOPS, tagged);
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
    const report = await convertSoundTree({ data: temp.game }, temp.out, NO_LOOPS, tagged);
    expect(report.clips).toBe(1);
    expect(await statIfExists(join(temp.out, 'sounds/misc/thunder.wav'))).toBeUndefined();
    expect(await statIfExists(join(temp.out, 'maps/community/some_map/briefing.flac'))).toBeUndefined();
  });
});

/** A 16-bit mono PCM wav of `samples`, as the mod ships its clips. */
function pcmWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, text: string): void => {
    for (const [i, char] of [...text].entries()) header.setUint8(at + i, char.charCodeAt(0));
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + samples.byteLength, true);
  ascii(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, 'data');
  header.setUint32(40, samples.byteLength, true);
  const out = new Uint8Array(44 + samples.byteLength);
  out.set(new Uint8Array(header.buffer));
  out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44);
  return out;
}

/** The packets of a single-stream Ogg file, header packets included, and its last granule. */
function oggPackets(bytes: Uint8Array): { packets: Uint8Array[]; granule: bigint } {
  const packets: Uint8Array[] = [];
  let partial: number[] = [];
  let granule = 0n;
  for (let at = 0; at < bytes.length; ) {
    const count = bytes[at + 26] ?? 0;
    const lacing = bytes.subarray(at + 27, at + 27 + count);
    granule = new DataView(bytes.buffer, bytes.byteOffset + at + 6, 8).getBigInt64(0, true);
    let body = at + 27 + count;
    for (const length of lacing) {
      partial.push(...bytes.subarray(body, body + length));
      body += length;
      if (length < 255) {
        packets.push(Uint8Array.from(partial));
        partial = [];
      }
    }
    at = body;
  }
  return { packets, granule };
}

describe('encodeSound', () => {
  const SAMPLE_RATE = 22050;
  const OPUS_RATE = 48000;
  const TONE_HZ = 440;
  const AMPLITUDE = 8000;
  const samples = Int16Array.from({ length: SAMPLE_RATE / 4 }, (_, i) =>
    Math.round(AMPLITUDE * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE)),
  );

  it('round-trips the lossless copy bit for bit as a bare FLAC stream', async () => {
    const flac = await encodeSound(pcmWav(samples, SAMPLE_RATE), 'lossless');
    expect(flac[4]).toBe(0x80); // STREAMINFO is the only metadata block
    const decoded = decodeFlac(flac);
    expect(decoded.sampleRate).toBe(SAMPLE_RATE);
    expect(decoded.channels).toEqual([samples]);
  });

  it('writes the compact copy as Ogg Opus that decodes to the tone at 48 kHz', async () => {
    const opus = await encodeSound(pcmWav(samples, SAMPLE_RATE), 'compact');
    const { packets, granule } = oggPackets(opus);
    const [head, tags, ...audio] = packets;
    expect(new TextDecoder().decode(head?.subarray(0, 8))).toBe('OpusHead');
    expect(new TextDecoder().decode(tags?.subarray(0, 8))).toBe('OpusTags');
    const preSkip = new DataView((head ?? new Uint8Array(12)).buffer).getUint16(10, true);
    const length = Math.ceil((samples.length * OPUS_RATE) / SAMPLE_RATE);
    expect(granule).toBe(BigInt(preSkip + length));

    const decoder = new Decoder({ channels: 1, sample_rate: OPUS_RATE });
    const pcm: number[] = [];
    for (const packet of audio) {
      const frame = decoder.decode(packet);
      pcm.push(...new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2));
    }
    decoder.drop();
    const decoded = pcm.slice(preSkip, preSkip + length);
    expect(decoded).toHaveLength(length);
    let signal = 0;
    let error = 0;
    for (const [i, v] of decoded.entries()) {
      const expected = AMPLITUDE * Math.sin((2 * Math.PI * TONE_HZ * i) / OPUS_RATE);
      signal += expected ** 2;
      error += (v - expected) ** 2;
    }
    expect(10 * Math.log10(signal / error)).toBeGreaterThan(20); // dB
  });
});
