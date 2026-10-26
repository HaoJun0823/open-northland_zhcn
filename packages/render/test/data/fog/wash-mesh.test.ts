import { describe, expect, it } from 'vitest';
import {
  fogWashIndices,
  fogWashLattice,
  fogWashPositions,
  fogWashVertexAlphas,
} from '../../../src/data/fog/index.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../../src/data/projection/index.js';
import { makeElevationField, projectNode } from '../../../src/data/terrain/index.js';

const BAND = { minCol: 1, maxCol: 2, minRow: 1, maxRow: 2 };
const GRID = 4;
const TEX = 64;
/** Cells 0..3 across, rows 1..3 down. */
const { cols: COLS } = fogWashLattice(BAND);

function vertex(positions: Float32Array, i: number, j: number) {
  const v = (j * COLS + i) * 2;
  return { x: positions[v], y: positions[v + 1] };
}

/** RGBA texels of a `TEX`-wide texture with the band's texels at the given alphas, row-major. */
function texels(alphas: readonly number[][]): Uint8Array {
  const bytes = new Uint8Array(TEX * TEX * 4);
  for (const [y, row] of alphas.entries())
    for (const [x, alpha] of row.entries()) bytes[(y * TEX + x) * 4 + 3] = alpha;
  return bytes;
}

describe('fogWashPositions', () => {
  it('puts each vertex on its cell centre, odd rows half a cell right', () => {
    const flat = fogWashPositions(BAND, GRID, GRID, undefined);
    // Vertex (1, 0) is cell (1, 1), an odd row; vertex (1, 1) is cell (1, 2).
    expect(vertex(flat, 1, 0)).toEqual({ x: 3 * TILE_HALF_W, y: TILE_HALF_H });
    expect(vertex(flat, 1, 1)).toEqual({ x: 2 * TILE_HALF_W, y: 2 * TILE_HALF_H });
    expect(vertex(flat, 0, 2)).toEqual({ x: TILE_HALF_W, y: 3 * TILE_HALF_H });
  });

  it('lifts each vertex with the ground mesh under it', () => {
    const elevation = makeElevationField([0, 0, 0, 0, 0, 10, 30, 0, 0, 20, 40, 0, 0, 0, 0, 0], GRID, GRID);
    const lifted = fogWashPositions(BAND, GRID, GRID, elevation);
    // Cell (2, 2) is node (4, 4); cell (1, 1) is node (3, 2).
    expect(vertex(lifted, 2, 1).y).toBeCloseTo(projectNode(elevation, 4, 4).y, 6);
    expect(vertex(lifted, 1, 0).y).toBeCloseTo(projectNode(elevation, 3, 2).y, 6);
  });

  it('never lifts a vertex above either of its neighbours in the row above', () => {
    // Uneven inner cells (the border ring lifts nothing), so a wrongly staggered pair would differ.
    const cliffs = makeElevationField([0, 0, 0, 0, 0, 5, 60, 0, 0, 90, 10, 0, 0, 0, 0, 0], GRID, GRID);
    const positions = fogWashPositions(BAND, GRID, GRID, cliffs);
    const rows = BAND.maxRow - BAND.minRow + 2;
    for (let j = 1; j < rows; j++) {
      // An even row's node sits between the cells (c-1, c) above; an odd row's between (c, c+1).
      const shift = (BAND.minRow + j) % 2 === 0 ? -1 : 0;
      for (let i = 0; i < COLS; i++) {
        for (const above of [i + shift, i + shift + 1]) {
          if (above < 0 || above >= COLS) continue;
          expect(vertex(positions, i, j).y ?? 0).toBeGreaterThanOrEqual(
            vertex(positions, above, j - 1).y ?? 0,
          );
        }
      }
    }
    // Cell (1, 2) rises 90 units over (0, 1) and (1, 1): held level with the lower of them, (0, 1).
    expect(vertex(positions, 1, 1).y).toBe(TILE_HALF_H);
  });
});

describe('fogWashVertexAlphas', () => {
  it('reads each vertex its cell texel, repeating the band edge outside it', () => {
    const alphas = fogWashVertexAlphas(
      BAND,
      texels([
        [10, 20],
        [30, 40],
      ]),
      TEX,
    );
    expect(Array.from(alphas)).toEqual([10, 10, 20, 20, 30, 30, 40, 40, 30, 30, 40, 40]);
  });
});

describe('fogWashIndices', () => {
  const FOGGED = new Uint8Array(COLS * 3).fill(90);

  it('draws two ground triangles a band cell over a fogged band', () => {
    expect(fogWashIndices(BAND, FOGGED).length).toBe(2 * 2 * 2 * 3);
  });

  it('builds the ground mesh triangles, the next row offset by the stagger', () => {
    // Cell (1, 1) on an odd row: A = own, SE-below (2, 2), SW-below (1, 2); B = own, E (2, 1), (2, 2).
    const indices = fogWashIndices(BAND, FOGGED);
    expect(Array.from(indices.subarray(0, 6))).toEqual([1, COLS + 2, COLS + 1, 1, 2, COLS + 2]);
    // Cell (1, 2) on an even row: below are (0, 3) and (1, 3).
    const evenRow = 2 * 2 * 3;
    expect(Array.from(indices.subarray(evenRow, evenRow + 3))).toEqual([COLS + 1, 2 * COLS + 1, 2 * COLS]);
  });

  it('leaves out the triangles whose three vertices are clear, so a lone cell washes a hexagon', () => {
    const lone = new Uint8Array(COLS * 3);
    lone[COLS + 2] = 90; // cell (2, 2)
    const drawn = fogWashIndices(BAND, lone);
    for (let k = 0; k < drawn.length; k += 3) {
      expect([drawn[k], drawn[k + 1], drawn[k + 2]]).toContain(COLS + 2);
    }
    expect(drawn.length / 3).toBe(6);
    expect(fogWashIndices(BAND, new Uint8Array(COLS * 3)).length).toBe(0);
  });
});
