import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW, SLANT_STEP } from '../world-metric.js';
import { slantDx } from './edges.js';
import type { TerrainGraph } from './graph.js';
import type { NodeId } from './node-id.js';

/** What one column-shifting edge saves over the half-column and half-row steps it stands in for. */
const SLANT_GAIN: Fixed = fx.sub(fx.add(HALF_COLUMN, HALF_ROW), SLANT_STEP);

/**
 * The fixed-point open-lattice walk distance between two nodes, the A* heuristic for the step set of
 * `edges.ts`. Exact on obstacle-free ground of one resistance, so it is admissible and consistent;
 * obstacles only raise the true cost. The cheapest walk takes composed diagonals for `min(ax, ay >> 1)`
 * of its half-columns, half-column steps for the rest and half-row steps for the rows left over; when
 * an odd row remains beside a half-column step, one column-shifting edge replaces the pair wherever it
 * slants the right way. Every other composition costs strictly more.
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
 * half-rows south of it, either negative for the other way. Only the slant turns the row parity, so an
 * optimal walk takes its one slant from the start row, and it pays off only toward that row's side.
 */
export function latticeOffsetDistance(dx: number, dy: number, fromY: number): Fixed {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return dx * slantDx(fromY) > 0 ? latticeOffsetFloor(ax, ay) : straightOffsetDistance(ax, ay);
}

/**
 * A lower bound on {@link latticeOffsetDistance} over every offset at least `ax` half-columns and `ay`
 * half-rows apart, whichever way it leans: the distance with the slant granted, which grows with either
 * offset. For a search that prunes a box of nodes by its nearest corner.
 */
export function latticeOffsetFloor(ax: number, ay: number): Fixed {
  const straight = straightOffsetDistance(ax, ay);
  return slantSaves(ax, ay) ? fx.sub(straight, SLANT_GAIN) : straight;
}

/** The cheapest walk `ax` half-columns and `ay` half-rows long over the half-column, half-row and
 *  composed diagonal steps alone. */
function straightOffsetDistance(ax: number, ay: number): Fixed {
  if (2 * ax <= ay) {
    // Vertical dominates: every half-column crosses diagonally, the leftover rows are half-row steps.
    return fx.add(fx.mulInt(DIAGONAL_STEP, ax), fx.mulInt(HALF_ROW, ay - 2 * ax));
  }
  // Sideways dominates: the diagonals absorb the rows, leaving one half-row when `ay` is odd.
  const d = ay >> 1;
  const straight = fx.mulInt(HALF_COLUMN, ax - d);
  const oddRow = (ay & 1) === 1 ? HALF_ROW : ZERO;
  return fx.add(fx.add(fx.mulInt(DIAGONAL_STEP, d), straight), oddRow);
}

/** Whether a walk `ax` half-columns and `ay` half-rows long ends with a half-column and half-row pair a
 *  slant can replace: an odd row count with the sideways steps dominating. */
function slantSaves(ax: number, ay: number): boolean {
  return (ay & 1) === 1 && 2 * ax > ay;
}
