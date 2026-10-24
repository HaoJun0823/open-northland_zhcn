import { describe, expect, it } from 'vitest';
import { NOISE_GRID_PX, noiseGridCells } from '../../src/gpu/weather/atmosphere.js';

describe('atmosphere noise grid', () => {
  it('keeps every cell within the noise spacing and at least one cell per side', () => {
    expect(noiseGridCells(1440)).toBe(1440 / NOISE_GRID_PX);
    expect(noiseGridCells(1441)).toBe(1440 / NOISE_GRID_PX + 1);
    expect(noiseGridCells(0)).toBe(1);
  });
});
