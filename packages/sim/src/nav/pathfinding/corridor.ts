import { fx } from '../../core/fixed.js';
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

/**
 * A route from `start` to `goal` that borrows `corridor`, a path already routed under the same `blocked`
 * overlay: a short search onto the corridor node nearest `start`, the corridor itself, and a short search
 * off the corridor node nearest `goal`. Not the lowest-cost route, only one within the two hops of it.
 * Returns `null` when either nearest node lies more than `maxHopNodes` (Manhattan half-cell nodes) away,
 * when either hop fails, runs past {@link CORRIDOR_LEG_MAX_EXPLORED} or is no straight hop, or when the
 * two nearest nodes leave no stretch of corridor to share.
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
): NodeId[] | null {
  const lattice = corridorLattice(graph, corridor);
  // No corridor node lies nearer `start` in Manhattan nodes than the corridor's bounding box does.
  if (manhattanOutside(lattice, graph.xOf(start), graph.yOf(start)) > maxHopNodes) return null;
  // Only the corridor's own start can be blocked, by the walker-exempt rule; no hop may end there.
  const entry = nearestStop(graph, lattice, corridor, start, 0, blocked);
  if (entry === undefined || manhattanNodes(graph, start, entry.node) > maxHopNodes) return null;
  const exit = nearestStop(graph, lattice, corridor, goal, entry.index, blocked);
  if (exit === undefined || exit.index === entry.index) return null;
  if (manhattanNodes(graph, exit.node, goal) > maxHopNodes) return null;
  const onto = findPathWithin(graph, start, entry.node, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED, traversal);
  if (typeof onto === 'string' || !isHop(graph, onto)) return null;
  const off = findPathWithin(graph, exit.node, goal, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED, traversal);
  if (typeof off === 'string' || !isHop(graph, off)) return null;
  return joinedLegs(onto, lattice, corridor, entry.index + 1, exit.index, off);
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

/** A corridor's node coordinates and bounding box, read once per corridor rather than per joining walker. */
interface CorridorLattice {
  readonly xs: Int32Array;
  readonly ys: Int32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** No node repeats, so no stretch of the corridor holds a loop of its own. */
  readonly loopFree: boolean;
}

/** Keyed by the corridor array, which a caller never mutates once routed. */
const lattices = new WeakMap<readonly NodeId[], CorridorLattice>();

function corridorLattice(graph: TerrainGraph, corridor: readonly NodeId[]): CorridorLattice {
  const held = lattices.get(corridor);
  if (held !== undefined) return held;
  const seen = new Set<NodeId>();
  const xs = new Int32Array(corridor.length);
  const ys = new Int32Array(corridor.length);
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < corridor.length; i++) {
    const node = corridor[i];
    if (node === undefined) continue;
    seen.add(node);
    const x = graph.xOf(node),
      y = graph.yOf(node);
    xs[i] = x;
    ys[i] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const lattice = { xs, ys, minX, maxX, minY, maxY, loopFree: seen.size === corridor.length };
  lattices.set(corridor, lattice);
  return lattice;
}

/** Manhattan nodes from (x, y) to the corridor's bounding box, 0 inside it. */
function manhattanOutside(lattice: CorridorLattice, x: number, y: number): number {
  const dx = Math.max(0, lattice.minX - x, x - lattice.maxX);
  const dy = Math.max(0, lattice.minY - y, y - lattice.maxY);
  return dx + dy;
}

/** The unblocked corridor node at or after index `from` nearest `target`, the earliest on a tie. Only a
 *  node nearer than the best so far is asked of `blocked`: an overlay's answers are pure. */
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
  const { xs, ys } = lattice;
  let best: CorridorStop | undefined;
  let bestDistance = fx.fromInt(0);
  for (let index = from; index < corridor.length; index++) {
    const distance = latticeOffsetDistance(Math.abs(x - (xs[index] ?? 0)), Math.abs(y - (ys[index] ?? 0)));
    if (best !== undefined && distance >= bestDistance) continue;
    const node = corridor[index];
    if (node === undefined || blocked.has(node)) continue;
    best = { index, node };
    bestDistance = distance;
  }
  return best;
}

/**
 * {@link withoutLoops} of `onto`, `corridor[from..to)` and `off`. The searched legs are loop-free, so when
 * the corridor is too and no node lies in two parts, the joined route is their plain concatenation and
 * the long corridor stretch is never indexed.
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
  for (let i = from; i < to && !shared; i++) {
    const node = corridor[i];
    shared = node !== undefined && legs.has(node);
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
