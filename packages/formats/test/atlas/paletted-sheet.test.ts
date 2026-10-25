import { describe, expect, it } from 'vitest';
import {
  ATLAS_PALETTE_BYTES,
  CANVAS_READ_INDEXED,
  colourIndexedSheet,
  decodeAtlasPalette,
  GREY_ALPHA_INDEXED,
} from '../../src/atlas/paletted-sheet.js';

describe('colourIndexedSheet', () => {
  const palette = new Uint8Array(ATLAS_PALETTE_BYTES);
  palette.set([10, 20, 30], 0);
  palette.set([200, 100, 50], 7 * 3);

  it('colours a covered pixel through its index, keeps its coverage, and zeroes an uncovered one', () => {
    // Opaque index 7, graded index 0, then an uncovered pixel whose stray index must not leak colour.
    const indexed = Uint8Array.from([7, 255, 0, 0x60, 7, 0]);
    const out = new Uint8ClampedArray(12).fill(99);
    colourIndexedSheet(indexed, GREY_ALPHA_INDEXED, palette, out);
    expect([...out]).toEqual([200, 100, 50, 255, 10, 20, 30, 0x60, 0, 0, 0, 0]);
  });

  it('writes each pixel from its index and coverage alone, for every index and coverage', () => {
    // Every (index, coverage) pair once, through a palette with a distinct colour per entry, against
    // the definition: palette colour and coverage where covered, all zero where not.
    const full = Uint8Array.from({ length: ATLAS_PALETTE_BYTES }, (_, i) => (i * 37 + 11) & 0xff);
    const pairs = 256 * 256;
    const indexed = new Uint8Array(pairs * 2);
    for (let i = 0; i < pairs; i++) {
      indexed[i * 2] = i & 0xff;
      indexed[i * 2 + 1] = i >> 8;
    }
    const out = new Uint8ClampedArray(pairs * 4).fill(99);
    colourIndexedSheet(indexed, GREY_ALPHA_INDEXED, full, out);
    const expected = new Uint8ClampedArray(pairs * 4);
    for (let i = 0; i < pairs; i++) {
      const index = i & 0xff;
      const coverage = i >> 8;
      if (coverage === 0) continue;
      expected[i * 4] = full[index * 3] ?? 0;
      expected[i * 4 + 1] = full[index * 3 + 1] ?? 0;
      expected[i * 4 + 2] = full[index * 3 + 2] ?? 0;
      expected[i * 4 + 3] = coverage;
    }
    expect(out.findIndex((byte, i) => byte !== expected[i])).toBe(-1);
  });

  it('colours into an output that does not start on a 4-byte boundary', () => {
    const indexed = Uint8Array.from([7, 255, 0, 0x60]);
    const backing = new Uint8Array(9).fill(99);
    colourIndexedSheet(indexed, GREY_ALPHA_INDEXED, palette, backing.subarray(1));
    expect([...backing.subarray(1)]).toEqual([200, 100, 50, 255, 10, 20, 30, 0x60]);
  });

  it('reads a canvas readback of the sheet: index in red, coverage in alpha', () => {
    const indexed = Uint8Array.from([7, 7, 7, 255, 0, 0, 0, 0x60]);
    const out = new Uint8ClampedArray(8);
    colourIndexedSheet(indexed, CANVAS_READ_INDEXED, palette, out);
    expect([...out]).toEqual([200, 100, 50, 255, 10, 20, 30, 0x60]);
  });
});

describe('decodeAtlasPalette', () => {
  it('round-trips the base64 palette a manifest carries', () => {
    const palette = Uint8Array.from({ length: ATLAS_PALETTE_BYTES }, (_, i) => (i * 7) & 0xff);
    expect(decodeAtlasPalette(Buffer.from(palette).toString('base64'))).toEqual(palette);
  });

  it('rejects a palette that is not 256 RGB entries', () => {
    expect(() => decodeAtlasPalette(Buffer.from([1, 2, 3]).toString('base64'))).toThrow(/768/);
  });
});
