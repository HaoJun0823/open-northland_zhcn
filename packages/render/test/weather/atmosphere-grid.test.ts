import { describe, expect, it } from 'vitest';
import { NOISE_GRID_PX, noiseGridCells, screenGrid } from '../../src/gpu/weather/atmosphere.js';

describe('atmosphere noise grid', () => {
  it('keeps every cell within the noise spacing and at least one cell per side', () => {
    expect(noiseGridCells(1440)).toBe(1440 / NOISE_GRID_PX);
    expect(noiseGridCells(1441)).toBe(1440 / NOISE_GRID_PX + 1);
    expect(noiseGridCells(0)).toBe(1);
  });

  it('spans the unit square in two triangles per cell', () => {
    const grid = screenGrid(2, 1);
    expect(Array.from(grid.getBuffer('aPosition').data)).toEqual([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]);
    expect(Array.from(grid.getIndex().data)).toEqual([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
    grid.destroy(true);
  });
});
