import { describe, expect, it } from 'vitest';
import {
  buildAlphaMask,
  lazyAlphaMask,
  MASK_BAND_ROWS,
  maskSolidAt,
  SOLID_ALPHA_MIN,
} from '../../../../src/gpu/sprite-pool/picking/alpha-mask.js';

/**
 * `alphaMaskOf` needs a real 2d context and returns null without one, leaving the picker on its box hit,
 * so only the threshold, packing and bounds logic is exercised here.
 */

/** An RGBA buffer of `width×height` with the given per-pixel alphas (row-major). */
function rgbaWithAlpha(width: number, height: number, alphas: readonly number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  alphas.forEach((a, i) => {
    rgba[i * 4 + 3] = a;
  });
  return rgba;
}

describe('buildAlphaMask / maskSolidAt', () => {
  it('marks a texel solid exactly when alpha >= SOLID_ALPHA_MIN', () => {
    const mask = buildAlphaMask(rgbaWithAlpha(2, 2, [0, SOLID_ALPHA_MIN - 1, SOLID_ALPHA_MIN, 255]), 2, 2);
    expect(maskSolidAt(mask, 0, 0)).toBe(false); // fully transparent
    expect(maskSolidAt(mask, 1, 0)).toBe(false); // soft shadow, below the threshold
    expect(maskSolidAt(mask, 0, 1)).toBe(true); // exactly at the threshold
    expect(maskSolidAt(mask, 1, 1)).toBe(true); // fully opaque
  });

  it('packs across byte boundaries (a 3×3 sheet spans two bytes)', () => {
    // Solid checkerboard: indices 0,2,4,6,8 - index 8 lives in the second packed byte.
    const alphas = [255, 0, 255, 0, 255, 0, 255, 0, 255];
    const mask = buildAlphaMask(rgbaWithAlpha(3, 3, alphas), 3, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(maskSolidAt(mask, x, y)).toBe((y * 3 + x) % 2 === 0);
      }
    }
  });

  it('reads coverage from green on an indexed sheet, whose alpha is opaque everywhere', () => {
    const GREEN = 1;
    // Index 9 uncovered, then index 0 covered: the layout's red is never coverage.
    const rgba = Uint8Array.from([9, 0, 0, 255, 0, 255, 0, 255]);
    const mask = buildAlphaMask(rgba, 2, 1, GREEN);
    expect(maskSolidAt(mask, 0, 0)).toBe(false);
    expect(maskSolidAt(mask, 1, 0)).toBe(true);
  });

  it('treats out-of-range coordinates as transparent', () => {
    const mask = buildAlphaMask(rgbaWithAlpha(2, 1, [255, 255]), 2, 1);
    expect(maskSolidAt(mask, -1, 0)).toBe(false);
    expect(maskSolidAt(mask, 2, 0)).toBe(false);
    expect(maskSolidAt(mask, 0, 1)).toBe(false);
  });
});

describe('lazyAlphaMask', () => {
  const ALPHA = 3;
  // An odd width, so packed rows do not start on byte boundaries, and a partial last band.
  const width = 37;
  const height = MASK_BAND_ROWS * 2 + 5;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba[i * 4 + ALPHA] = (i * 97 + 13) % 256;
  const rowsOf = (y0: number, rows: number): Uint8Array =>
    rgba.subarray(y0 * width * 4, (y0 + rows) * width * 4);

  it('answers every texel as the whole-page mask does', () => {
    const whole = buildAlphaMask(rgba, width, height);
    const lazy = lazyAlphaMask(width, height, ALPHA, rowsOf);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) expect(maskSolidAt(lazy, x, y)).toBe(maskSolidAt(whole, x, y));
    }
  });

  it('reads only the bands its tests land in, once each', () => {
    const reads: number[] = [];
    const lazy = lazyAlphaMask(width, height, ALPHA, (y0, rows) => {
      reads.push(y0);
      return rowsOf(y0, rows);
    });
    maskSolidAt(lazy, 3, MASK_BAND_ROWS + 1);
    maskSolidAt(lazy, 30, MASK_BAND_ROWS * 2 - 1);
    maskSolidAt(lazy, 0, height - 1);
    expect(reads).toEqual([MASK_BAND_ROWS, MASK_BAND_ROWS * 2]);
  });

  it('leaves a band it cannot read transparent', () => {
    const lazy = lazyAlphaMask(width, height, ALPHA, () => null);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) expect(maskSolidAt(lazy, x, y)).toBe(false);
    }
  });
});
