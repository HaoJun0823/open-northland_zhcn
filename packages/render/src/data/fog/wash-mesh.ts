import { rowStagger, TILE_HALF_H, TILE_HALF_W, type TileRange } from '../projection/index.js';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';

/** The fog wash's lifted vertex grid over one band of the one-texel-per-cell fog texture. */
export interface FogWashGeometry {
  /** World px, `[x0, y0, x1, y1, …]`. */
  readonly positions: Float32Array;
  /** Normalized to the whole texture, `[u0, v0, …]`. */
  readonly uvs: Float32Array;
}

/** RGBA bytes per texel; a texel's alpha is its last byte. */
export const TEXEL_BYTES = 4;
export const ALPHA_BYTE = 3;
const INDICES_PER_QUAD = 6;

/**
 * One vertex per texel centre, cell (c, r) at `(2c·TILE_HALF_W, r·TILE_HALF_H)` raised by the terrain's
 * lift under that point, so the wash rides the hills it darkens: drawn flat, a lifted hill showed the
 * ground of cells rows further south through the wash of cells nearer the viewer, while its objects
 * stayed culled by their own cell. The outer ring sits half a texel beyond the band and repeats the edge
 * texel, covering the same box a flat quad did without sampling past the band.
 *
 * The x lattice ignores the odd-row half-cell stagger (a named approximation, invisible under a
 * cell-wide gradient), so the lift is read where the terrain row actually passes that x. Where a slope
 * rises toward the viewer faster than a row step, a column's vertices are held at the row above instead
 * of folding back over it, so overlapping strips never stack the wash's alpha. {@link fogWashIndices}
 * names the quads drawn.
 */
export function fogWashGeometry(
  band: TileRange,
  texW: number,
  texH: number,
  elevation: ElevationField | undefined,
): FogWashGeometry {
  const bandW = band.maxCol - band.minCol + 1;
  const bandH = band.maxRow - band.minRow + 1;
  const cols = bandW + 2;
  const rows = bandH + 2;
  const positions = new Float32Array(cols * rows * 2);
  const uvs = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    const texelY = Math.min(Math.max(j - 1, 0), bandH - 1);
    const row = band.minRow + Math.min(Math.max(j - 1, -0.5), bandH - 0.5);
    const terrainColShift = rowStagger(row) / 2;
    for (let i = 0; i < cols; i++) {
      const texelX = Math.min(Math.max(i - 1, 0), bandW - 1);
      const col = band.minCol + Math.min(Math.max(i - 1, -0.5), bandW - 0.5);
      const v = (j * cols + i) * 2;
      positions[v] = 2 * TILE_HALF_W * col;
      const lifted = TILE_HALF_H * row - terrainLiftAt(elevation, col - terrainColShift, row);
      const above = j === 0 ? Number.NEGATIVE_INFINITY : (positions[v - cols * 2 + 1] ?? lifted);
      positions[v + 1] = Math.max(lifted, above);
      uvs[v] = (texelX + 0.5) / texW;
      uvs[v + 1] = (texelY + 0.5) / texH;
    }
  }
  return { positions, uvs };
}

/**
 * The triangles of {@link fogWashGeometry}'s grid over the band's `bandW x bandH` texels that darken
 * anything. Each quad spans its corners' texel centres, so linear filtering samples those four texels
 * alone: a quad whose four are clear washes nothing and is left out. `texels` is the texture's RGBA
 * bytes, `rowTexels` texels a row.
 */
export function fogWashIndices(
  bandW: number,
  bandH: number,
  texels: Uint8Array,
  rowTexels: number,
): Uint32Array {
  const cols = bandW + 2;
  const rows = bandH + 2;
  const alphaAt = (i: number, j: number): number => {
    const x = Math.min(Math.max(i - 1, 0), bandW - 1);
    const y = Math.min(Math.max(j - 1, 0), bandH - 1);
    return texels[(y * rowTexels + x) * TEXEL_BYTES + ALPHA_BYTE] ?? 0;
  };
  const indices = new Uint32Array((cols - 1) * (rows - 1) * INDICES_PER_QUAD);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      if (alphaAt(i, j) + alphaAt(i + 1, j) + alphaAt(i, j + 1) + alphaAt(i + 1, j + 1) === 0) continue;
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  return indices.subarray(0, k);
}
