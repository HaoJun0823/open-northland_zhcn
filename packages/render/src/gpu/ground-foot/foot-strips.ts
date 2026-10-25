import type { FootBake } from './foot-bakes.js';

const RGBA = 4;
const ALPHA = 3;
/** Strip edges fall on multiples of this many baked px, which keeps the partition search small. */
const STRIP_STEP_PX = 4;
/** Texels a linear sample reaches past the texel it lands in, so a strip keeps them round its paint. */
const SAMPLE_REACH_PX = 1;

/** A strip of a bake in its own pixels: columns `x .. x + width`, rows `y .. y + height`. */
export interface FootStrip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * At most `maxStrips` vertical strips of `bake` that hold every pixel a linear sample of it can draw:
 * each strip spans its columns from one row above to one row below what is painted there or in the column
 * either side. The columns are split where the strips' area is smallest, so a foot's sloping band draws
 * as a few tight quads instead of its whole mostly clear box. Columns nothing reaches belong to no strip.
 */
export function footStrips(bake: FootBake, maxStrips: number): FootStrip[] {
  const { width, height, pixels } = bake;
  const top = new Int32Array(width).fill(height);
  const bottom = new Int32Array(width).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((pixels[(y * width + x) * RGBA + ALPHA] ?? 0) === 0) continue;
      if (y < (top[x] ?? height)) top[x] = y;
      bottom[x] = y;
    }
  }
  const steps = Math.ceil(width / STRIP_STEP_PX);
  const edge = (step: number): number => Math.min(width, step * STRIP_STEP_PX);
  // The rows a strip over steps [from, to) spans, its columns and the column either side: first in
  // spanTop, last in spanBottom at from * steps + to - 1; spanBottom below spanTop where it reaches no paint.
  const spanTop = new Int32Array(steps * steps);
  const spanBottom = new Int32Array(steps * steps).fill(-1);
  for (let i = 0; i < steps; i++) {
    let y0 = height;
    let y1 = -1;
    const left = edge(i) - SAMPLE_REACH_PX;
    if (left >= 0) {
      y0 = top[left] ?? height;
      y1 = bottom[left] ?? -1;
    }
    for (let j = i + 1; j <= steps; j++) {
      for (let x = edge(j - 1); x < edge(j); x++) {
        y0 = Math.min(y0, top[x] ?? height);
        y1 = Math.max(y1, bottom[x] ?? -1);
      }
      const right = edge(j);
      const r0 = right < width ? Math.min(y0, top[right] ?? height) : y0;
      const r1 = right < width ? Math.max(y1, bottom[right] ?? -1) : y1;
      if (r1 < r0) continue;
      spanTop[i * steps + j - 1] = Math.max(0, r0 - SAMPLE_REACH_PX);
      spanBottom[i * steps + j - 1] = Math.min(height - 1, r1 + SAMPLE_REACH_PX);
    }
  }
  const rowsIn = (from: number, to: number): number =>
    Math.max(0, (spanBottom[from * steps + to - 1] ?? -1) - (spanTop[from * steps + to - 1] ?? 0) + 1);
  const area = (from: number, to: number): number => (edge(to) - edge(from)) * rowsIn(from, to);
  // best[k][j]: least area covering steps [0, j) with k strips; cut[k][j]: where the last one starts.
  const strips = Math.max(1, Math.min(maxStrips, steps));
  const best = Array.from({ length: strips + 1 }, () =>
    new Float64Array(steps + 1).fill(Number.POSITIVE_INFINITY),
  );
  const cut = Array.from({ length: strips + 1 }, () => new Int32Array(steps + 1));
  const first = best[0];
  if (first !== undefined) first[0] = 0;
  for (let k = 1; k <= strips; k++) {
    const row = best[k];
    const before = best[k - 1];
    const cuts = cut[k];
    if (row === undefined || before === undefined || cuts === undefined) continue;
    for (let j = 1; j <= steps; j++) {
      for (let i = k - 1; i < j; i++) {
        const cost = (before[i] ?? Number.POSITIVE_INFINITY) + area(i, j);
        if (cost < (row[j] ?? Number.POSITIVE_INFINITY)) {
          row[j] = cost;
          cuts[j] = i;
        }
      }
    }
  }
  let k = 1;
  for (let n = 2; n <= strips; n++) if ((best[n]?.[steps] ?? 0) < (best[k]?.[steps] ?? 0)) k = n;
  const out: FootStrip[] = [];
  for (let j = steps; k > 0; k--) {
    const i = cut[k]?.[j] ?? 0;
    const rowCount = rowsIn(i, j);
    if (rowCount > 0)
      out.push({
        x: edge(i),
        y: spanTop[i * steps + j - 1] ?? 0,
        width: edge(j) - edge(i),
        height: rowCount,
      });
    j = i;
  }
  return out.reverse();
}
