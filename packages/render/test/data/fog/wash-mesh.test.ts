import { describe, expect, it } from 'vitest';
import { fogWashGeometry, fogWashIndices } from '../../../src/data/fog/index.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../../src/data/projection/index.js';
import { elevationLiftPerUnit, makeElevationField, projectNode } from '../../../src/data/terrain/index.js';

const LIFT = elevationLiftPerUnit();
const BAND = { minCol: 1, maxCol: 2, minRow: 1, maxRow: 2 };
const TEX = 64;
/** The band's 2x2 texels plus the outer ring: 4 vertices a row. */
const COLS = 4;

function vertex(geometry: ReturnType<typeof fogWashGeometry>, i: number, j: number) {
  const v = (j * COLS + i) * 2;
  return {
    x: geometry.positions[v],
    y: geometry.positions[v + 1],
    u: geometry.uvs[v],
    v: geometry.uvs[v + 1],
  };
}

describe('fogWashGeometry', () => {
  it('centres each texel on its flat cell and repeats the edge texel half a cell beyond the band', () => {
    const flat = fogWashGeometry(BAND, TEX, TEX, undefined);
    expect(vertex(flat, 1, 1)).toEqual({ x: 2 * TILE_HALF_W, y: TILE_HALF_H, u: 0.5 / TEX, v: 0.5 / TEX });
    expect(vertex(flat, 2, 2)).toEqual({
      x: 4 * TILE_HALF_W,
      y: 2 * TILE_HALF_H,
      u: 1.5 / TEX,
      v: 1.5 / TEX,
    });
    expect(vertex(flat, 0, 0)).toEqual({ x: TILE_HALF_W, y: TILE_HALF_H / 2, u: 0.5 / TEX, v: 0.5 / TEX });
    expect(vertex(flat, 3, 3)).toEqual({
      x: 5 * TILE_HALF_W,
      y: 2.5 * TILE_HALF_H,
      u: 1.5 / TEX,
      v: 1.5 / TEX,
    });
  });

  it('lifts each vertex with the ground mesh under it, so a hill keeps its own cells lit', () => {
    // Row 2 is even: cell (2, 2) is a ground mesh vertex. Row 1 is odd: x = 2·HALF_W·2 lies halfway
    // along the ground edge between cells (1, 1) and (2, 1).
    const elevation = makeElevationField([0, 0, 0, 0, 0, 10, 30, 0, 0, 20, 40, 0, 0, 0, 0, 0], 4, 4);
    const lifted = fogWashGeometry(BAND, TEX, TEX, elevation);
    expect(vertex(lifted, 2, 2).y).toBeCloseTo(projectNode(elevation, 4, 4).y, 6);
    expect(vertex(lifted, 2, 2).y).toBeCloseTo(2 * TILE_HALF_H - 40 * LIFT, 6);
    expect(vertex(lifted, 2, 1).y).toBeCloseTo(TILE_HALF_H - 20 * LIFT, 6);
    expect(vertex(lifted, 2, 2).x).toBe(4 * TILE_HALF_W);
  });

  it('holds a column at the row above where a slope rises faster than a row step, never folding', () => {
    // Cell (2, 2) rises 80 units (95 px) over cell (2, 1): flat it would draw above its northern row.
    const cliff = makeElevationField([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 0, 0], 4, 4);
    const geometry = fogWashGeometry(BAND, TEX, TEX, cliff);
    for (let i = 0; i < COLS; i++) {
      for (let j = 1; j < COLS; j++) {
        expect(vertex(geometry, i, j).y ?? 0).toBeGreaterThanOrEqual(vertex(geometry, i, j - 1).y ?? 0);
      }
    }
  });
});

describe('fogWashIndices', () => {
  /** RGBA texels of a `TEX`-wide texture with the band's texels at the given alphas, row-major. */
  function texels(alphas: readonly number[][]): Uint8Array {
    const bytes = new Uint8Array(TEX * TEX * 4);
    for (const [y, row] of alphas.entries())
      for (const [x, alpha] of row.entries()) bytes[(y * TEX + x) * 4 + 3] = alpha;
    return bytes;
  }
  /** The grid quads the indices draw, as `i,j` of their first vertex. */
  function quads(indices: Uint32Array): string[] {
    const out: string[] = [];
    for (let k = 0; k < indices.length; k += 6) {
      const a = indices[k] ?? 0;
      out.push(`${a % COLS},${Math.floor(a / COLS)}`);
    }
    return out;
  }

  it('draws every quad over a fogged band', () => {
    expect(
      fogWashIndices(
        2,
        2,
        texels([
          [90, 90],
          [90, 90],
        ]),
        TEX,
      ).length,
    ).toBe(3 * 3 * 6);
  });

  it('leaves out the quads whose four corner texels are clear, including the outer ring', () => {
    // Only texel (1, 1) washes: the quads touching its vertex (2, 2) draw, the rest sample clear texels.
    expect(
      quads(
        fogWashIndices(
          2,
          2,
          texels([
            [0, 0],
            [0, 90],
          ]),
          TEX,
        ),
      ),
    ).toEqual(['1,1', '2,1', '1,2', '2,2']);
    expect(
      fogWashIndices(
        2,
        2,
        texels([
          [0, 0],
          [0, 0],
        ]),
        TEX,
      ).length,
    ).toBe(0);
  });

  it('keeps the two triangles of a drawn quad', () => {
    const indices = fogWashIndices(
      2,
      2,
      texels([
        [90, 0],
        [0, 0],
      ]),
      TEX,
    );
    expect(Array.from(indices.subarray(0, 6))).toEqual([0, 1, COLS, 1, COLS + 1, COLS]);
  });
});
