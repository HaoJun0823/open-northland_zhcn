/**
 * Column steps: the NORTH and SOUTH walk directions (`THexagonDirection` 6 and 7 in the shipped
 * `logicdefines.inc`), which the route search never expands. A human's or vehicle's walk replaces an
 * SE+SW or SW+SE pair by one SOUTH step and an NW+NE or NE+NW pair by one NORTH step, so a column is
 * walked straight. The node between the two rows is skipped: the walker never stops on it. The search
 * had already opened both edges.
 *
 * Approximation: the original merges while walking, whenever the next node's search field holds the
 * opposite slant among equally cheap directions, and prefers the walker's current direction among them;
 * it measures the goal tail to its current search target, which can be an intermediate waypoint. This
 * build merges consecutive slant pairs of the one path found, greedily from the start, and measures the
 * tail to the route's final goal.
 */
import { hexDistanceBetween } from '../halfcell.js';
import type { NodeId, TerrainGraph } from '../terrain/index.js';

/**
 * Original behavior: a walker this many map points from its goal (hex distance, the route's length
 * aside), or nearer, no longer merges a pair, so the walk's last steps stay single edges.
 */
export const STRAIGHT_STEP_GOAL_TAIL_NODES = 3;

/** The half-cell rows one column step spans. */
const COLUMN_STEP_ROWS = 2;

/** Whether `a`, `b`, `c` are two row-crossing edges the same way up or down that end in `a`'s column. */
function formsColumnStep(terrain: TerrainGraph, a: NodeId, b: NodeId, c: NodeId): boolean {
  const ay = terrain.yOf(a);
  const by = terrain.yOf(b);
  const cy = terrain.yOf(c);
  const rowStep = by - ay;
  return (rowStep === 1 || rowStep === -1) && cy - by === rowStep && terrain.xOf(c) === terrain.xOf(a);
}

/**
 * `path` with every mergeable pair of row-crossing edges walked as one column step: the pair's middle node
 * dropped. Returns `path` itself when nothing merges; a step that already is a column step stays as it is.
 */
export function straightenColumnSteps(terrain: TerrainGraph, path: readonly NodeId[]): readonly NodeId[] {
  const last = path.length - 1;
  const goal = path[last];
  if (goal === undefined) return path;
  const goalX = terrain.xOf(goal);
  const goalY = terrain.yOf(goal);
  let out: NodeId[] | undefined;
  let i = 0;
  while (i < last) {
    const a = path[i];
    const b = path[i + 1];
    const c = path[i + 2];
    if (
      a !== undefined &&
      b !== undefined &&
      c !== undefined &&
      hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), goalX, goalY) > STRAIGHT_STEP_GOAL_TAIL_NODES &&
      formsColumnStep(terrain, a, b, c)
    ) {
      out ??= path.slice(0, i + 1);
      out.push(c);
      i += 2;
    } else {
      if (out !== undefined && b !== undefined) out.push(b);
      i += 1;
    }
  }
  return out ?? path;
}

/** Whether a step from `from` to `to` is a column step, two rows straight up or down. */
export function isColumnStep(terrain: TerrainGraph, from: NodeId, to: NodeId): boolean {
  return (
    terrain.xOf(from) === terrain.xOf(to) &&
    Math.abs(terrain.yOf(to) - terrain.yOf(from)) === COLUMN_STEP_ROWS
  );
}

/**
 * The two nodes a column step from `from` passes between, on the row it skips: the west one, then the
 * east one. A node off the map reads as undefined. `from` and `to` must form a column step.
 */
export function columnStepMiddles(
  terrain: TerrainGraph,
  from: NodeId,
  to: NodeId,
): readonly [NodeId | undefined, NodeId | undefined] {
  const x = terrain.xOf(from);
  const fromY = terrain.yOf(from);
  const row = (fromY + terrain.yOf(to)) / COLUMN_STEP_ROWS;
  // An even row's row-crossing edges keep the column or shift west, an odd row's keep it or shift east.
  const west = x - 1 + (fromY & 1);
  const east = west + 1;
  const at = (hx: number): NodeId | undefined =>
    hx >= 0 && hx < terrain.width ? terrain.nodeAt(hx, row) : undefined;
  return [at(west), at(east)];
}
