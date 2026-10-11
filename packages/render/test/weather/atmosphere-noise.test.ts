import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_NOISE_PERIOD, latticeCorners } from '../../src/gpu/weather/atmosphere-noise.js';

const PERIOD = ATMOSPHERE_NOISE_PERIOD;
const TEXEL_BYTES = 4;
const CORNERS = 4;

/** A readback whose cell (x, y) encodes `x * PERIOD + y + 1` over 2^24 in its three colour bytes. */
function readback(): Uint8Array {
  const pixels = new Uint8Array(PERIOD * PERIOD * TEXEL_BYTES);
  for (let y = 0; y < PERIOD; y++) {
    for (let x = 0; x < PERIOD; x++) {
      const n = x * PERIOD + y + 1;
      const i = (y * PERIOD + x) * TEXEL_BYTES;
      pixels[i] = n >> 16;
      pixels[i + 1] = (n >> 8) & 0xff;
      pixels[i + 2] = n & 0xff;
      pixels[i + 3] = 0xff;
    }
  }
  return pixels;
}

const cell = (x: number, y: number): number => (x * PERIOD + y + 1) / 2 ** 24;

describe('atmosphere noise lattice', () => {
  const corners = latticeCorners(readback());

  it('stores each cell with its right, lower and diagonal neighbours', () => {
    const at = (x: number, y: number): number[] =>
      Array.from(corners.subarray((y * PERIOD + x) * CORNERS, (y * PERIOD + x + 1) * CORNERS));
    expect(at(3, 7)).toEqual([cell(3, 7), cell(4, 7), cell(3, 8), cell(4, 8)].map(Math.fround));
  });

  it('wraps the neighbours of the last row and column onto the first', () => {
    const last = PERIOD - 1;
    const o = (last * PERIOD + last) * CORNERS;
    expect(Array.from(corners.subarray(o, o + CORNERS))).toEqual(
      [cell(last, last), cell(0, last), cell(last, 0), cell(0, 0)].map(Math.fround),
    );
  });

  it('keeps the 24-bit fraction exact in float32', () => {
    const top = new Uint8Array(PERIOD * PERIOD * TEXEL_BYTES).fill(0xff);
    expect(latticeCorners(top)[0]).toBe(1 - 2 ** -24);
  });
});
