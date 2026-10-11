import { type HalfCellNode, HEX_DIRECTIONS, stepHex } from '../../../../nav/halfcell.js';

// Approximation pending observation in the running original: expand in six-neighbour breadth order,
// east first, turning clockwise. The centre has priority; row parity changes diagonal neighbours.
// Terrain-dependent search costs and the original's separate standing/drop points are not modelled.
// The radius is a bounded-search safeguard, not a confirmed original yard size.
const MAX_RADIUS = 32;

function offsetsForRow(row: number): readonly HalfCellNode[] {
  const centre = { hx: 0, hy: row };
  const points = [centre];
  const seen = new Set([`0,${row}`]);
  let start = 0;
  for (let radius = 0; radius < MAX_RADIUS; radius++) {
    const end = points.length;
    for (let i = start; i < end; i++) {
      const point = points[i];
      if (point === undefined) continue;
      for (const direction of HEX_DIRECTIONS) {
        const next = stepHex(point, direction);
        const key = `${next.hx},${next.hy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(next);
      }
    }
    start = end;
  }
  return points.map(({ hx, hy }) => ({ hx, hy: hy - row }));
}

// Geometry only: shared by worlds, independent of occupancy, map dimensions and simulation state.
const EVEN_ROW = offsetsForRow(0);
const ODD_ROW = offsetsForRow(1);

export function yardOffsets(flagRow: number): readonly HalfCellNode[] {
  return (flagRow & 1) === 0 ? EVEN_ROW : ODD_ROW;
}
