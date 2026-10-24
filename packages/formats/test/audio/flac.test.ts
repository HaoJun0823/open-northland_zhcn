import { describe, expect, it } from 'vitest';
import { encodeFlac } from '../../src/audio/flac.js';
import { decodeFlac } from '../support/flac-decode.js';

const RATE = 22050;
const BLOCK = 2304;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
/** "fLaC", the metadata block header and STREAMINFO come before the first frame. */
const FIRST_FRAME_AT = 4 + 4 + 34;
/** Within a frame header: sync (2 bytes), then block size and rate codes in one byte. */
const RATE_CODE_BYTE = 2;
/** Sync, the code byte, the channel/sample-size byte and frame 0's one-byte number. */
const RATE_VALUE_AT = 5;
const SAMPLE_RATE_KHZ_8_BIT = 0b1100;
const SAMPLE_RATE_HZ_16_BIT = 0b1101;
const SAMPLE_RATE_TENS_HZ_16_BIT = 0b1110;

/** A deterministic pseudo-random sequence (a 32-bit LCG), so noise fixtures stay stable. */
function noise(length: number, amplitude: number, seed = 1): Int16Array {
  const out = new Int16Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = Math.round(((state / 2 ** 32) * 2 - 1) * amplitude);
  }
  return out;
}

function tone(length: number, hz: number, amplitude: number, rate = RATE): Int16Array {
  return Int16Array.from({ length }, (_, i) =>
    Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / rate)),
  );
}

function roundTrip(channels: Int16Array[], sampleRate = RATE, blockSize = BLOCK): Uint8Array {
  const flac = encodeFlac({ sampleRate, channels }, { blockSize });
  const decoded = decodeFlac(flac);
  expect(decoded.sampleRate).toBe(sampleRate);
  expect(decoded.totalSamples).toBe(channels[0]?.length);
  expect(decoded.channels).toEqual(channels);
  return flac;
}

describe('encodeFlac', () => {
  it('round-trips a tone bit for bit and codes it far below its PCM size', () => {
    const samples = tone(RATE, 440, 8000);
    const flac = roundTrip([samples]);
    expect(flac.length).toBeLessThan(samples.byteLength / 4);
  });

  it('round-trips white noise, full-scale extremes and a step', () => {
    roundTrip([noise(5000, INT16_MAX)]);
    roundTrip([Int16Array.from({ length: 3000 }, (_, i) => (i % 2 === 0 ? INT16_MIN : INT16_MAX))]);
    roundTrip([Int16Array.from({ length: 3000 }, (_, i) => (i < 1500 ? INT16_MIN : INT16_MAX))]);
  });

  it('codes silence as constant subframes', () => {
    const flac = roundTrip([new Int16Array(RATE)]);
    expect(flac.length).toBeLessThan(200);
  });

  it('drops the zero low bits of a clip scaled up from 8 bits', () => {
    const eightBit = noise(4 * BLOCK, 127).map((v) => v * 256);
    const flac = roundTrip([eightBit]);
    expect(flac.length).toBeLessThan(4 * BLOCK * 1.1);
  });

  it('writes a short last block, a clip shorter than a block and a single sample', () => {
    roundTrip([tone(BLOCK * 2 + 77, 300, 12000)]);
    roundTrip([tone(300, 300, 12000)]);
    roundTrip([tone(3, 300, 12000)]);
    roundTrip([Int16Array.of(-5)]);
  });

  it('writes a rate without its own code into every frame header, as the subset requires', () => {
    // 11025 Hz is the mod's one such clip; 12 kHz is a whole kHz, 100010 Hz needs tens of Hz.
    const rateFields: ReadonlyArray<readonly [number, number, number[]]> = [
      [11025, SAMPLE_RATE_HZ_16_BIT, [11025 >> 8, 11025 & 0xff]],
      [12000, SAMPLE_RATE_KHZ_8_BIT, [12]],
      [100010, SAMPLE_RATE_TENS_HZ_16_BIT, [10001 >> 8, 10001 & 0xff]],
    ];
    for (const [rate, code, value] of rateFields) {
      const flac = roundTrip([tone(20000, 220, 9000, rate)], rate);
      expect((flac[FIRST_FRAME_AT + RATE_CODE_BYTE] ?? 0) & 0x0f).toBe(code);
      // Frame 0 has a one-byte number and the block size its own code, so the value follows them.
      expect([
        ...flac.subarray(FIRST_FRAME_AT + RATE_VALUE_AT, FIRST_FRAME_AT + RATE_VALUE_AT + value.length),
      ]).toEqual(value);
    }
  });

  it('rejects a rate no frame header can carry', () => {
    expect(() => encodeFlac({ sampleRate: 100001, channels: [new Int16Array(10)] })).toThrow(/sample rate/);
  });

  it('codes several channels independently and accepts other block sizes', () => {
    roundTrip([tone(10000, 440, 8000), noise(10000, 3000)], RATE, 4096);
    roundTrip([tone(10000, 440, 8000)], RATE, 4608);
  });

  it('numbers frames past 127 in the extended UTF-8 form', () => {
    roundTrip([noise(300 * 16, 100)], RATE, 16);
  });

  it('writes an empty stream as STREAMINFO alone', () => {
    const flac = roundTrip([new Int16Array(0)]);
    expect(flac.length).toBe(4 + 4 + 34);
  });

  it('records the block and frame size bounds in STREAMINFO', () => {
    const flac = encodeFlac(
      { sampleRate: RATE, channels: [tone(BLOCK * 3, 440, 8000)] },
      { blockSize: BLOCK },
    );
    const decoded = decodeFlac(flac);
    expect([decoded.minBlockSize, decoded.maxBlockSize]).toEqual([BLOCK, BLOCK]);
  });

  it('rejects a block size outside the subset and mismatched channels', () => {
    expect(() => encodeFlac({ sampleRate: RATE, channels: [new Int16Array(10)] }, { blockSize: 8 })).toThrow(
      /block size/,
    );
    expect(() =>
      encodeFlac({ sampleRate: RATE, channels: [new Int16Array(10)] }, { blockSize: 8192 }),
    ).toThrow(/block size/);
    expect(() => encodeFlac({ sampleRate: RATE, channels: [new Int16Array(10), new Int16Array(9)] })).toThrow(
      /length/,
    );
    expect(() => encodeFlac({ sampleRate: RATE, channels: [] })).toThrow(/channels/);
  });
});
