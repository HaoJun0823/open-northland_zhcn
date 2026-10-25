import { describe, expect, it } from 'vitest';
import type { FootBake } from '../../../src/gpu/ground-foot/foot-bakes.js';
import { type FootStrip, footStrips } from '../../../src/gpu/ground-foot/foot-strips.js';

/** A `width`×`height` bake with alpha painted where `painted(x, y)` holds. */
function bake(width: number, height: number, painted: (x: number, y: number) => boolean): FootBake {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (painted(x, y)) pixels[(y * width + x) * 4 + 3] = 255;
  return { left: 0, top: 0, width, height, resolution: 1, pixels };
}

const inside = (strips: readonly FootStrip[], x: number, y: number): boolean =>
  strips.some((s) => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height);

/** Every pixel a linear sample can carry paint into: one within a texel of a painted one. */
function reached(b: FootBake, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (
        px >= 0 &&
        py >= 0 &&
        px < b.width &&
        py < b.height &&
        (b.pixels[(py * b.width + px) * 4 + 3] ?? 0) > 0
      )
        return true;
    }
  return false;
}

const areaOf = (strips: readonly FootStrip[]): number =>
  strips.reduce((sum, s) => sum + s.width * s.height, 0);

describe('footStrips', () => {
  // A foot's V: a band four px thick falling half a px per px to the middle and rising again.
  const vee = bake(96, 40, (x, y) => {
    const line = 30 - Math.abs(x - 48) / 2;
    return y >= line && y < line + 4;
  });

  it('keeps every pixel a linear sample can draw', () => {
    const strips = footStrips(vee, 4);
    for (let y = 0; y < vee.height; y++)
      for (let x = 0; x < vee.width; x++) if (reached(vee, x, y)) expect(inside(strips, x, y)).toBe(true);
  });

  it('covers a sloping band with far less than its box, and more strips with less', () => {
    const one = areaOf(footStrips(vee, 1));
    const four = areaOf(footStrips(vee, 4));
    expect(one).toBe(96 * 30);
    expect(four).toBeLessThan(0.6 * one);
    expect(areaOf(footStrips(vee, 8))).toBeLessThan(four);
  });

  it('leaves out columns nothing reaches and never overlaps two strips', () => {
    const apart = bake(64, 10, (x, y) => y === 5 && (x < 8 || x >= 56));
    const strips = footStrips(apart, 3);
    expect(areaOf(strips)).toBeLessThan(64 * 3);
    for (let x = 0; x < 64; x++)
      expect(strips.filter((s) => x >= s.x && x < s.x + s.width).length).toBeLessThanOrEqual(1);
  });
});
