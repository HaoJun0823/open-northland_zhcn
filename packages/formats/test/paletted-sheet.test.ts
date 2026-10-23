import { describe, expect, it } from 'vitest';
import {
  ATLAS_PALETTE_BYTES,
  CANVAS_READ_INDEXED,
  colourIndexedSheet,
  decodeAtlasPalette,
  GREY_ALPHA_INDEXED,
} from '../src/atlas/paletted-sheet.js';

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
