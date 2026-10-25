import { describe, expect, it } from 'vitest';
import {
  backingResolutionFor,
  windowResolutionFor,
  worldUpscaleFor,
} from '../../../src/gpu/pixi-app/pixi-app.js';

describe('backingResolutionFor', () => {
  it('keeps integer ratios as-is', () => {
    expect(backingResolutionFor(1)).toBe(1);
    expect(backingResolutionFor(2)).toBe(2);
    expect(backingResolutionFor(3)).toBe(3);
  });

  it('preserves fractional display density without a compositor downscale', () => {
    for (const dpr of [0.8, 1.25, 1.5, 1.75, 2.5, 2.0000004]) {
      expect(backingResolutionFor(dpr)).toBe(dpr);
      expect(windowResolutionFor(dpr, 1)).toBe(dpr);
    }
  });

  it('falls back to 1 for degenerate ratios', () => {
    expect(backingResolutionFor(0)).toBe(1);
    expect(backingResolutionFor(-2)).toBe(1);
    expect(backingResolutionFor(Number.NaN)).toBe(1);
    expect(backingResolutionFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('windowResolutionFor', () => {
  it('multiplies the device density by the render scale', () => {
    expect(windowResolutionFor(1, 1)).toBe(1);
    expect(windowResolutionFor(1, 0.5)).toBe(0.5);
    expect(windowResolutionFor(2, 0.75)).toBe(1.5);
    expect(windowResolutionFor(1.5, 2)).toBe(3);
  });

  it('falls back to scale 1 for a degenerate scale', () => {
    expect(windowResolutionFor(2, 0)).toBe(2);
    expect(windowResolutionFor(2, -1)).toBe(2);
    expect(windowResolutionFor(2, Number.NaN)).toBe(2);
    expect(windowResolutionFor(2, Number.POSITIVE_INFINITY)).toBe(2);
  });
});

describe('windowResolutionFor at whole density', () => {
  it('draws one texel per whole step of the ratio, so the upscale repeats exact squares', () => {
    expect(windowResolutionFor(2, 1, 'whole')).toBe(1);
    expect(windowResolutionFor(3, 1, 'whole')).toBe(1);
    expect(windowResolutionFor(2.5, 1, 'whole')).toBe(1.25);
    expect(windowResolutionFor(1.9999999, 1, 'whole')).toBeCloseTo(1, 6);
  });

  it('keeps a ratio under 2 native, having no whole factor to divide by', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75]) expect(windowResolutionFor(dpr, 1, 'whole')).toBe(dpr);
  });

  it('applies the render scale after the division', () => {
    expect(windowResolutionFor(2, 1.5, 'whole')).toBe(1.5);
  });
});

describe('the upscaling densities', () => {
  it('keep the backing store native and draw the world at the render scale', () => {
    expect(windowResolutionFor(2, 1, 'sharp')).toBe(2);
    expect(worldUpscaleFor('xbr', 1)).toEqual({ filter: 'xbr', resolution: 1 });
    expect(worldUpscaleFor('sharp', 1.5)).toEqual({ filter: 'sharp', resolution: 1.5 });
  });

  it('leave the world native under the other densities', () => {
    expect(worldUpscaleFor('native', 1)).toBeNull();
    expect(worldUpscaleFor('whole', 1)).toBeNull();
  });
});
