import { type Fixed, fx } from '../../core/fixed.js';
import { HALF_COLUMN, QUARTER_COLUMN, ROW_EDGE } from '../world-metric.js';
import type { TerrainGraph } from './graph.js';
import type { NodeId } from './node-id.js';

/** What a row-crossing edge costs beyond the quarter column of sideways ground it covers. */
const ROW_EDGE_OVER_QUARTER: Fixed = fx.sub(ROW_EDGE, QUARTER_COLUMN);

/**
 * The fixed-point open-lattice walk distance between two nodes, the A* heuristic for the step set of
 * `edges.ts`. Exact on obstacle-free ground of one resistance, so it is admissible and consistent;
 * obstacles only raise the true cost.
 */
export function nodeLatticeDistance(g: TerrainGraph, a: NodeId, b: NodeId): Fixed {
  return latticeDistanceTo(g, g.xOf(b), g.yOf(b), a);
}

/**
 * {@link nodeLatticeDistance} with one endpoint already resolved to coordinates, since the goal's
 * coordinates are a loop invariant of an A* search.
 */
export function latticeDistanceTo(g: TerrainGraph, bx: number, by: number, a: NodeId): Fixed {
  // `yOf` once and the column by subtraction: the same integers as `xOf`/`yOf`, one division fewer.
  const ay = g.yOf(a);
  return latticeOffsetDistance(bx - (a - ay * g.width), by - ay, ay);
}

/**
 * {@link nodeLatticeDistance} from a node on row `fromY` to the node `dx` half-columns east and `dy`
 * half-rows south of it, either negative for the other way.
 */
export function latticeOffsetDistance(dx: number, dy: number, fromY: number): Fixed {
  return doubledColumnDistance(2 * dx + ((fromY + dy) & 1) - (fromY & 1), dy);
}

/**
 * The open-lattice walk distance across `ddx` quarter columns east (a node's doubled column,
 * `2*hx + (hy & 1)`, so the odd-row shift is integral) and `dy` half-rows south. Every row needs one
 * row-crossing edge, each a quarter column either way, and the sideways ground left over takes half-column
 * steps; `ddx` and `dy` share a parity, so it is whole.
 */
export function doubledColumnDistance(ddx: number, dy: number): Fixed {
  const rows = Math.abs(dy);
  const sideways = Math.abs(ddx) - rows;
  const crossing = fx.mulInt(ROW_EDGE, rows);
  return sideways > 0 ? fx.add(crossing, fx.mulInt(HALF_COLUMN, sideways >> 1)) : crossing;
}

/**
 * A lower bound on {@link latticeOffsetDistance} over every offset at least `ax` half-columns and `ay`
 * half-rows apart, whichever way it leans, which grows with either offset. For a search that prunes a
 * box of nodes by its nearest corner. Each term is a lower bound no step undercuts: a row-crossing edge per
 * row, and a quarter column per quarter column with the edge's surplus per row.
 */
export function latticeOffsetFloor(ax: number, ay: number): Fixed {
  const byRows = fx.mulInt(ROW_EDGE, ay);
  const quarters = Math.max(0, 2 * ax - 1);
  const bySideways = fx.add(fx.mulInt(QUARTER_COLUMN, quarters), fx.mulInt(ROW_EDGE_OVER_QUARTER, ay));
  return byRows > bySideways ? byRows : bySideways;
}
