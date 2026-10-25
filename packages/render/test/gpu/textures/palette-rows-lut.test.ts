import { describe, expect, it, vi } from 'vitest';
import { PaletteRowsLut } from '../../../src/gpu/textures/palette-rows-lut.js';

const RGB = 3;

function palette(seed: number): Uint8Array {
  return Uint8Array.from({ length: 256 * RGB }, (_, i) => (i * seed + 11) % 256);
}

describe('PaletteRowsLut', () => {
  it('draws a palette past its rows through the first row, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lut = new PaletteRowsLut(1);
    expect(lut.fixedRow(palette(3))).toBe(0);
    expect(lut.fixedRow(palette(5))).toBe(0);
    expect(lut.fixedRow(palette(7))).toBe(0);
    expect(lut.overflows).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives each stem palette a row of its own, even one with the same entries', () => {
    const lut = new PaletteRowsLut();
    const stem = palette(3);
    expect(lut.fixedRow(stem)).toBe(0);
    expect(lut.fixedRow(palette(3))).toBe(1);
    expect(lut.fixedRow(stem)).toBe(0);
  });
});
