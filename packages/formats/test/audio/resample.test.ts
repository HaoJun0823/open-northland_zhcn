import { describe, expect, it } from 'vitest';
import { resample } from '../../src/audio/resample.js';

function sine(length: number, hz: number, rate: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
}

/** Root mean square over the middle half, away from the zero-padded edges. */
function middleRms(x: Float32Array): number {
  let sum = 0;
  const from = Math.floor(x.length / 4);
  const to = Math.floor((3 * x.length) / 4);
  for (let i = from; i < to; i++) sum += (x[i] ?? 0) ** 2;
  return Math.sqrt(sum / (to - from));
}

describe('resample', () => {
  it('produces ceil(length * to / from) samples', () => {
    expect(resample(new Float32Array(22050), 22050, 48000)).toHaveLength(48000);
    expect(resample(new Float32Array(1001), 22050, 48000)).toHaveLength(Math.ceil((1001 * 320) / 147));
    expect(resample(new Float32Array(1000), 11025, 48000)).toHaveLength(Math.ceil((1000 * 640) / 147));
    expect(resample(new Float32Array(1000), 48000, 22050)).toHaveLength(460);
  });

  it('copies at an unchanged rate', () => {
    const x = sine(100, 440, 22050);
    expect(resample(x, 22050, 22050)).toEqual(x);
  });

  it('keeps a pass-band tone at its level and phase', () => {
    const up = resample(sine(22050, 1000, 22050), 22050, 48000);
    const expected = sine(48000, 1000, 48000);
    expect(middleRms(up)).toBeCloseTo(middleRms(expected), 3);
    const error = up.map((v, i) => v - (expected[i] ?? 0));
    expect(middleRms(error)).toBeLessThan(1e-3);
  });

  it('removes a tone above the lower Nyquist frequency when going down', () => {
    const down = resample(sine(48000, 15000, 48000), 48000, 22050);
    expect(middleRms(down)).toBeLessThan(1e-3);
  });

  it('rejects non-integer and non-positive rates', () => {
    expect(() => resample(new Float32Array(4), 0, 48000)).toThrow(/rates/);
    expect(() => resample(new Float32Array(4), 22050.5, 48000)).toThrow(/rates/);
  });
});
