import { halfCellToScreenX, halfCellToScreenY, type TileRange } from '../projection/index.js';
import { type ElevationField, nodeLift } from '../terrain/index.js';

/** RGBA bytes per texel; a texel's alpha is its last byte. */
export const TEXEL_BYTES = 4;
export const ALPHA_BYTE = 3;
const VERTICES_PER_TRIANGLE = 3;
const TRIANGLES_PER_CELL = 2;

/**
 * The fog wash's vertex lattice over one band of cells: the ground mesh's own vertices, one per cell
 * centre node, covering the band's ground triangles (`triangleANodes`/`triangleBNodes`), which reach one
 * cell column either side of the band and one row below it. Vertex `(i, j)` is cell
 * `(band.minCol - 1 + i, band.minRow + j)`.
 */
export interface FogWashLattice {
  readonly cols: number;
  readonly rows: number;
}

export function fogWashLattice(band: TileRange): FogWashLattice {
  return { cols: band.maxCol - band.minCol + 3, rows: band.maxRow - band.minRow + 2 };
}

/** Of a row's cell `c`, the column offset of the left one of the two cells whose nodes flank it in the
 *  next row: an odd row's nodes sit half a cell right, so `c` sits over (c, c+1), an even row's over
 *  (c-1, c). The same offset names a node's two neighbours in the row above. */
function nextRowShift(row: number): number {
  return (row & 1) === 1 ? 0 : -1;
}

/**
 * The lattice's world px, `[x0, y0, x1, y1, …]`, lifted exactly as the ground mesh lifts its vertices,
 * so the wash rides the hills it darkens. Where a slope rises toward the viewer faster than a row step,
 * a vertex is held level with the lower of its two neighbours in the row above instead of folding back
 * over them, so overlapping strips never stack the wash's alpha.
 */
export function fogWashPositions(
  band: TileRange,
  gridW: number,
  gridH: number,
  elevation: ElevationField | undefined,
): Float32Array {
  const { cols, rows } = fogWashLattice(band);
  const positions = new Float32Array(cols * rows * 2);
  const liftAt = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt : undefined;
  for (let j = 0; j < rows; j++) {
    const row = band.minRow + j;
    const hy = 2 * row;
    const aboveShift = nextRowShift(row);
    for (let i = 0; i < cols; i++) {
      const hx = 2 * (band.minCol - 1 + i) + (row & 1);
      let y = halfCellToScreenY(hy) - (liftAt === undefined ? 0 : nodeLift(liftAt, hx, hy, gridW, gridH));
      if (j > 0) {
        const left = Math.max(i + aboveShift, 0);
        const right = Math.min(i + aboveShift + 1, cols - 1);
        const aboveRow = (j - 1) * cols;
        y = Math.max(
          y,
          positions[(aboveRow + left) * 2 + 1] ?? y,
          positions[(aboveRow + right) * 2 + 1] ?? y,
        );
      }
      const v = (j * cols + i) * 2;
      positions[v] = halfCellToScreenX(hx, hy);
      positions[v + 1] = y;
    }
  }
  return positions;
}

/**
 * Each lattice vertex's wash alpha: its cell's texel, where a vertex outside the band repeats the band's
 * edge texel. `texels` is the band texture's RGBA bytes, `rowTexels` texels a row.
 */
export function fogWashVertexAlphas(band: TileRange, texels: Uint8Array, rowTexels: number): Uint8Array {
  const { cols, rows } = fogWashLattice(band);
  const bandW = band.maxCol - band.minCol + 1;
  const bandH = band.maxRow - band.minRow + 1;
  const alphas = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const y = Math.min(j, bandH - 1);
    for (let i = 0; i < cols; i++) {
      const x = Math.min(Math.max(i - 1, 0), bandW - 1);
      alphas[j * cols + i] = texels[(y * rowTexels + x) * TEXEL_BYTES + ALPHA_BYTE] ?? 0;
    }
  }
  return alphas;
}

/**
 * The band cells' two ground triangles each, as the ground mesh builds them (A = own node, SE-below,
 * SW-below; B = own node, E, SE-below), less those whose three vertices are clear. Alpha interpolates
 * across each triangle from its vertices, as the original's per-vertex brightness does across its ground
 * triangles, so a lone cell's wash is the hexagon of the six triangles meeting at its node.
 */
export function fogWashIndices(band: TileRange, alphas: Uint8Array): Uint32Array {
  const { cols } = fogWashLattice(band);
  const cells = (band.maxCol - band.minCol + 1) * (band.maxRow - band.minRow + 1);
  const indices = new Uint32Array(cells * TRIANGLES_PER_CELL * VERTICES_PER_TRIANGLE);
  let k = 0;
  const push = (a: number, b: number, c: number): void => {
    if ((alphas[a] ?? 0) + (alphas[b] ?? 0) + (alphas[c] ?? 0) === 0) return;
    indices[k++] = a;
    indices[k++] = b;
    indices[k++] = c;
  };
  for (let j = 0; j <= band.maxRow - band.minRow; j++) {
    const belowLeft = (j + 1) * cols + nextRowShift(band.minRow + j);
    for (let i = 1; i <= band.maxCol - band.minCol + 1; i++) {
      const own = j * cols + i;
      const sw = belowLeft + i;
      push(own, sw + 1, sw);
      push(own, own + 1, sw + 1);
    }
  }
  return indices.subarray(0, k);
}
