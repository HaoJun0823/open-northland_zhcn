import { describe, expect, it } from 'vitest';
import { oggCrc, oggStream } from '../src/audio/ogg.js';
import { oggOpus } from '../src/audio/ogg-opus.js';

interface Page {
  readonly flags: number;
  readonly granule: bigint;
  readonly sequence: number;
  readonly lacing: number[];
  readonly body: Uint8Array;
  readonly crcMatches: boolean;
}

function pages(bytes: Uint8Array): Page[] {
  const out: Page[] = [];
  for (let at = 0; at < bytes.length; ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at);
    expect(String.fromCharCode(...bytes.subarray(at, at + 4))).toBe('OggS');
    const count = bytes[at + 26] ?? 0;
    const lacing = [...bytes.subarray(at + 27, at + 27 + count)];
    const size = 27 + count + lacing.reduce((a, b) => a + b, 0);
    const copy = bytes.slice(at, at + size);
    new DataView(copy.buffer).setUint32(22, 0, true);
    out.push({
      flags: bytes[at + 5] ?? 0,
      granule: view.getBigInt64(6, true),
      sequence: view.getUint32(18, true),
      lacing,
      body: bytes.subarray(at + 27 + count, at + size),
      crcMatches: oggCrc(copy) === view.getUint32(22, true),
    });
    at += size;
  }
  return out;
}

/** 20 ms of Ogg Opus silence muxed by libogg's conventions elsewhere; its page CRCs are the
 *  reference this muxer's CRC must reproduce. */
const REFERENCE_OGG_OPUS =
  'T2dnUwACAAAAAAAAAAAAAAAAAAAAAAIotXIBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAAAAAAABAAAASZW+VAEu' +
  'T3B1c1RhZ3MGAAAAZmZtcGVnAQAAABQAAABlbmNvZGVyPUxhdmMgbGlib3B1c09nZ1MABPgEAAAAAAAAAAAAAAIAAADbWnPVAgcG' +
  'CAvmOyOrYAgIrLMOxg==';

const packet = (length: number, fill = 1): Uint8Array => new Uint8Array(length).fill(fill);

describe('oggCrc', () => {
  it('matches the CRC of every page of a reference Ogg Opus file', () => {
    const reference = Uint8Array.from(atob(REFERENCE_OGG_OPUS), (c) => c.charCodeAt(0));
    const parsed = pages(reference);
    expect(parsed).toHaveLength(3);
    expect(parsed.every((p) => p.crcMatches)).toBe(true);
  });
});

describe('oggStream', () => {
  it('marks the first and last pages and gives each page its last packet granule', () => {
    const out = pages(
      oggStream(7, [
        { data: packet(10), granule: 0, flush: true },
        { data: packet(20), granule: 960 },
        { data: packet(30), granule: 1920 },
      ]),
    );
    expect(out.map((p) => [p.flags, p.granule, p.sequence])).toEqual([
      [0x02, 0n, 0],
      [0x04, 1920n, 1],
    ]);
    expect(out[1]?.lacing).toEqual([20, 30]);
    expect(out.every((p) => p.crcMatches)).toBe(true);
  });

  it('ends a packet of a multiple of 255 bytes with an empty segment', () => {
    const [only] = pages(oggStream(1, [{ data: packet(510), granule: 5 }]));
    expect(only?.lacing).toEqual([255, 255, 0]);
    expect(only?.flags).toBe(0x02 | 0x04);
  });

  it('continues a packet longer than one page on the next, with no granule on the first', () => {
    const big = packet(255 * 255 + 100, 9);
    const out = pages(oggStream(1, [{ data: big, granule: 42 }]));
    expect(out.map((p) => [p.flags, p.granule])).toEqual([
      [0x02, -1n],
      [0x01 | 0x04, 42n],
    ]);
    expect(out[0]?.lacing).toHaveLength(255);
    expect(out[1]?.lacing).toEqual([100]);
    expect(out.reduce((sum, p) => sum + p.body.length, 0)).toBe(big.length);
  });

  it('opens a new page once 255 segments are full', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ data: packet(3), granule: (i + 1) * 960 }));
    const out = pages(oggStream(1, many));
    expect(out.map((p) => p.lacing.length)).toEqual([255, 45]);
    expect(out[0]?.granule).toBe(255n * 960n);
  });
});

describe('oggOpus', () => {
  const base = {
    channelCount: 1,
    inputSampleRate: 22050,
    preSkip: 312,
    packetSamples: 960,
    samples: 1500,
    packets: [packet(5), packet(6)],
    serial: 3,
    vendor: 'test',
  };

  it('writes OpusHead and OpusTags on pages of their own and trims the end by granule', () => {
    const out = pages(oggOpus(base));
    expect(out).toHaveLength(3);
    const head = out[0]?.body ?? new Uint8Array();
    const view = new DataView(head.buffer, head.byteOffset);
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead');
    expect([head[8], head[9], view.getUint16(10, true), view.getUint32(12, true), head[18]]).toEqual([
      1, 1, 312, 22050, 0,
    ]);
    expect(String.fromCharCode(...(out[1]?.body.subarray(0, 8) ?? []))).toBe('OpusTags');
    expect(out[1]?.granule).toBe(0n);
    expect(out[2]?.granule).toBe(312n + 1500n);
    expect(out[2]?.flags).toBe(0x04);
  });

  it('rejects packets that end before the stated samples and unsupported channel counts', () => {
    expect(() => oggOpus({ ...base, samples: 2000 })).toThrow(/end before/);
    expect(() => oggOpus({ ...base, channelCount: 3 })).toThrow(/channels/);
  });
});
