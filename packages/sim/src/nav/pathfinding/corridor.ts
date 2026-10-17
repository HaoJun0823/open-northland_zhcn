import { type Fixed, fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import {
  latticeOffsetDistance,
  type NodeId,
  nodeLatticeDistance,
  type TerrainGraph,
  type Traversal,
} from '../terrain/index.js';
import { findPathWithin, type SearchStats } from './find-path.js';

/**
 * The settle cap of each short search on or off a shared corridor. A leg that needs more is no short
 * hop, so the caller routes the walker on its own. Authored: far above an open hop across a group's area,
 * far below a march's own search.
 */
const CORRIDOR_LEG_MAX_EXPLORED = 2048;

/** How far a walker may stand from the corridor it boards, and the settle cap of its search onto it. */
export interface CorridorEntry {
  readonly hopNodes: number;
  readonly legMaxExplored: number;
}

/**
 * A route from `start` to `goal` that borrows `corridor`, a path already routed under the same `blocked`
 * overlay: a short search onto the corridor node nearest `start`, the corridor itself, and a short search
 * off the corridor node nearest `goal`. Not the lowest-cost route, only one within the two hops of it.
 * Returns `null` when either nearest node lies more than its hop (Manhattan half-cell nodes) away,
 * when either hop fails, runs past its settle cap or is no straight hop, or when the two nearest nodes
 * leave no stretch of corridor to share. `entry` widens the boarding side and `exit` the side off the
 * corridor; by default both take `maxHopNodes` and {@link CORRIDOR_LEG_MAX_EXPLORED}.
 */
export function joinCorridor(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats,
  maxHopNodes: number,
  traversal: Traversal = 'land',
  entry: CorridorEntry = { hopNodes: maxHopNodes, legMaxExplored: CORRIDOR_LEG_MAX_EXPLORED },
  exit: CorridorEntry = { hopNodes: maxHopNodes, legMaxExplored: CORRIDOR_LEG_MAX_EXPLORED },
): NodeId[] | null {
  const lattice = corridorLattice(graph, corridor);
  // No corridor node lies nearer `start` in Manhattan nodes than the corridor's bounding box does.
  if (manhattanOutside(lattice, graph.xOf(start), graph.yOf(start)) > entry.hopNodes) return null;
  // Only the corridor's own start can be blocked, by the walker-exempt rule; no hop may end there.
  const board = nearestStop(graph, lattice, corridor, start, 0, blocked);
  if (board === undefined || manhattanNodes(graph, start, board.node) > entry.hopNodes) return null;
  const alight = nearestStop(graph, lattice, corridor, goal, board.index, blocked);
  if (alight === undefined || alight.index === board.index) return null;
  if (manhattanNodes(graph, alight.node, goal) > exit.hopNodes) return null;
  const onto = findPathWithin(graph, start, board.node, blocked, stats, entry.legMaxExplored, traversal);
  if (typeof onto === 'string' || !isHop(graph, onto)) return null;
  const off = findPathWithin(graph, alight.node, goal, blocked, stats, exit.legMaxExplored, traversal);
  if (typeof off === 'string' || !isHop(graph, off)) return null;
  return joinedLegs(onto, lattice, corridor, board.index + 1, alight.index, off);
}

/** Manhattan half-cell nodes from `node` to the nearest node of `corridor`. */
export function corridorGap(graph: TerrainGraph, corridor: readonly NodeId[], node: NodeId): number {
  const { xs, ys } = corridorLattice(graph, corridor);
  const x = graph.xOf(node);
  const y = graph.yOf(node);
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(x - (xs[i] ?? 0)) + Math.abs(y - (ys[i] ?? 0));
    if (d < gap) gap = d;
  }
  return gap;
}

/**
 * Whether `leg` walks at most twice the straight lattice distance between its ends. A leg that has to go
 * round a wall to reach its stop drags the walker away from its own way and back, a detour its own search
 * would never take; a sidestep round a body stays within the bound.
 */
function isHop(graph: TerrainGraph, leg: readonly NodeId[]): boolean {
  const [from] = leg;
  const to = leg.at(-1);
  if (from === undefined || to === undefined) return false;
  const straight = nodeLatticeDistance(graph, from, to);
  let walked = fx.fromInt(0);
  leg.forEach((node, i) => {
    const previous = leg[i - 1];
    if (previous !== undefined) walked = fx.add(walked, nodeLatticeDistance(graph, previous, node));
  });
  return walked <= fx.add(straight, straight);
}

function manhattanNodes(graph: TerrainGraph, a: NodeId, b: NodeId): number {
  return Math.abs(graph.xOf(a) - graph.xOf(b)) + Math.abs(graph.yOf(a) - graph.yOf(b));
}

interface CorridorStop {
  readonly index: number;
  readonly node: NodeId;
}

/** Corridor nodes per block whose bounding box lets {@link nearestStop} skip the block whole. Authored:
 *  a block spans at most twice this many lattice steps, short against a march and long against a scan. */
const STOP_BLOCK_NODES = 32;

/** A corridor's node coordinates and bounding boxes, read once per corridor rather than per joining walker. */
interface CorridorLattice {
  readonly xs: Int32Array;
  readonly ys: Int32Array;
  /** Per {@link STOP_BLOCK_NODES} block: min x, max x, min y, max y. */
  readonly blocks: Int32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** No node repeats, so no stretch of the corridor holds a loop of its own. */
  readonly loopFree: boolean;
  /** Each node's index, exact when {@link loopFree}. */
  readonly indexOf: ReadonlyMap<NodeId, number>;
}

/** Keyed by the corridor array, which a caller never mutates once routed. */
const lattices = new WeakMap<readonly NodeId[], CorridorLattice>();

function corridorLattice(graph: TerrainGraph, corridor: readonly NodeId[]): CorridorLattice {
  const held = lattices.get(corridor);
  if (held !== undefined) return held;
  const indexOf = new Map<NodeId, number>();
  const xs = new Int32Array(corridor.length);
  const ys = new Int32Array(corridor.length);
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < corridor.length; i++) {
    const node = corridor[i];
    if (node === undefined) continue;
    if (!indexOf.has(node)) indexOf.set(node, i);
    const x = graph.xOf(node),
      y = graph.yOf(node);
    xs[i] = x;
    ys[i] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const blocks = new Int32Array(Math.ceil(corridor.length / STOP_BLOCK_NODES) * BLOCK_FIELDS);
  for (let block = 0; block * STOP_BLOCK_NODES < corridor.length; block++) {
    const first = block * STOP_BLOCK_NODES;
    const last = Math.min(corridor.length, first + STOP_BLOCK_NODES);
    let bMinX = xs[first] ?? 0,
      bMaxX = bMinX,
      bMinY = ys[first] ?? 0,
      bMaxY = bMinY;
    for (let i = first + 1; i < last; i++) {
      const x = xs[i] ?? 0,
        y = ys[i] ?? 0;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }
    const at = block * BLOCK_FIELDS;
    blocks[at] = bMinX;
    blocks[at + 1] = bMaxX;
    blocks[at + 2] = bMinY;
    blocks[at + 3] = bMaxY;
  }
  const lattice = {
    xs,
    ys,
    blocks,
    minX,
    maxX,
    minY,
    maxY,
    loopFree: indexOf.size === corridor.length,
    indexOf,
  };
  lattices.set(corridor, lattice);
  return lattice;
}

/** Manhattan nodes from (x, y) to the corridor's bounding box, 0 inside it. */
function manhattanOutside(lattice: CorridorLattice, x: number, y: number): number {
  const dx = Math.max(0, lattice.minX - x, x - lattice.maxX);
  const dy = Math.max(0, lattice.minY - y, y - lattice.maxY);
  return dx + dy;
}

const BLOCK_FIELDS = 4;

/**
 * A lower bound on {@link latticeOffsetDistance} over every offset at least `ax` half-columns and `ay`
 * half-rows: the distance grows with either offset except from an odd half-row count to the next even
 * one, so the even count at or below `ay` bounds the rest.
 */
export function latticeOffsetFloor(ax: number, ay: number): Fixed {
  return latticeOffsetDistance(ax, ay - (ay & 1));
}

/** The unblocked corridor node at or after index `from` nearest `target`, the earliest on a tie. Only a
 *  node nearer than the best so far is asked of `blocked`: an overlay's answers are pure. A block whose
 *  box lies no nearer than the best so far holds no such node and is skipped whole. */
function nearestStop(
  graph: TerrainGraph,
  lattice: CorridorLattice,
  corridor: readonly NodeId[],
  target: NodeId,
  from: number,
  blocked: BlockOverlay,
): CorridorStop | undefined {
  const x = graph.xOf(target);
  const y = graph.yOf(target);
  const { xs, ys, blocks } = lattice;
  let best: CorridorStop | undefined;
  let bestDistance = fx.fromInt(0);
  for (let index = from; index < corridor.length; ) {
    if (best !== undefined && index % STOP_BLOCK_NODES === 0) {
      const at = (index / STOP_BLOCK_NODES) * BLOCK_FIELDS;
      const ax = Math.max(0, (blocks[at] ?? 0) - x, x - (blocks[at + 1] ?? 0));
      const ay = Math.max(0, (blocks[at + 2] ?? 0) - y, y - (blocks[at + 3] ?? 0));
      if (latticeOffsetFloor(ax, ay) >= bestDistance) {
        index += STOP_BLOCK_NODES;
        continue;
      }
    }
    const distance = latticeOffsetDistance(Math.abs(x - (xs[index] ?? 0)), Math.abs(y - (ys[index] ?? 0)));
    const node = corridor[index];
    index++;
    if (best !== undefined && distance >= bestDistance) continue;
    if (node === undefined || blocked.has(node)) continue;
    best = { index: index - 1, node };
    bestDistance = distance;
  }
  return best;
}

/**
 * {@link withoutLoops} of `onto`, `corridor[from..to)` and `off`. The searched legs are loop-free, so when
 * the corridor is too and no node lies in two parts, the joined route is their plain concatenation and
 * the long corridor stretch is never indexed; the legs' nodes are looked up in the corridor's own index.
 */
function joinedLegs(
  onto: readonly NodeId[],
  lattice: CorridorLattice,
  corridor: readonly NodeId[],
  from: number,
  to: number,
  off: readonly NodeId[],
): NodeId[] {
  const legs = new Set<NodeId>(onto);
  let shared = !lattice.loopFree || off.some((node) => legs.has(node));
  for (const node of off) legs.add(node);
  for (const node of legs) {
    if (shared) break;
    const at = lattice.indexOf.get(node);
    shared = at !== undefined && at >= from && at < to;
  }
  const joined = [...onto];
  for (let i = from; i < to; i++) {
    const node = corridor[i];
    if (node !== undefined) joined.push(node);
  }
  for (const node of off) joined.push(node);
  return shared ? withoutLoops(joined) : joined;
}

/** `path` with every revisit cut back to the node's first visit, so a hop that crosses the corridor
 *  elsewhere never walks out and back. Neighbours stay lattice neighbours. */
function withoutLoops(path: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const indexOf = new Map<NodeId, number>();
  for (const node of path) {
    const seen = indexOf.get(node);
    if (seen === undefined) {
      indexOf.set(node, out.length);
      out.push(node);
      continue;
    }
    for (const dropped of out.splice(seen + 1)) indexOf.delete(dropped);
  }
  return out;
}
