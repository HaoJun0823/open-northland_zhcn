import type { BlockOverlay } from './block-overlay.js';
import { ringSearch } from './ring-search.js';
import { NEIGHBOUR_OFFSETS } from './terrain/edges.js';
import type { NodeId, TerrainGraph, Traversal } from './terrain/index.js';

/**
 * How many nodes {@link nearestUnblockedNode} visits around a blocked anchor before giving up.
 * Authored: a search-cost guard sized to ring several bodies deep around a crowded target, or to step a
 * click that landed on a footprint out to its walkable edge.
 */
export const NEAREST_NODE_SEARCH_CAP = 64;

const NO_NODES: ReadonlySet<NodeId> = new Set();

/**
 * Whether `node` keeps an exit: one orthogonal neighbour it is joined to that a mover of `traversal` may
 * stand on and `blocked` leaves open. Every stand a search returns must pass it, so nobody is parked in
 * a one-node nook between footprints. Approximation: the composed diagonal steps the pathfinder also
 * takes are not counted, so a node whose only way out is diagonal counts as sealed.
 */
export function hasOpenSide(
  terrain: TerrainGraph,
  node: NodeId,
  blocked: BlockOverlay,
  traversal: Traversal = 'land',
): boolean {
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  for (let i = 0; i < NEIGHBOUR_OFFSETS.length; i++) {
    const offset = NEIGHBOUR_OFFSETS[i];
    if (offset === undefined) continue;
    const nx = x + offset[0];
    const ny = y + offset[1];
    if (!terrain.inBounds(nx, ny)) continue;
    const n = terrain.nodeAt(nx, ny);
    if (terrain.traversable(n, traversal) && !blocked.has(n) && terrain.joined(node, n)) return true;
  }
  return false;
}

export interface NearestUnblockedOptions {
  /** Nodes traversed but never returned, so two callers aiming at one crowded spot fan out. */
  readonly claimed?: ReadonlySet<NodeId> | undefined;
  /** Nodes traversed but never returned for any caller, such as building doorways. */
  readonly avoid?: ReadonlySet<NodeId> | undefined;
  /** When no open-sided node lies within the cap, return the nearest sealed one that passes the other
   *  tests instead of null. */
  readonly sealedFallback?: boolean;
  readonly cap?: number;
  readonly traversal?: Traversal;
  /** The walk blocks a landing must keep an {@link hasOpenSide} against, when `blocked` also holds
   *  standing units that will move off; defaults to `blocked`. */
  readonly walls?: BlockOverlay;
}

/**
 * The nearest node to `from` that is neither walk-blocked (`blocked`), claimed nor avoided and keeps an
 * open side, bounded by `cap` (default {@link NEAREST_NODE_SEARCH_CAP}).
 *
 * The search traverses blocked nodes, leaving reachability to the follow-up A*, so the free node behind
 * a rank of bodies is a fine anchor.
 */
export function nearestUnblockedNode(
  terrain: TerrainGraph,
  from: NodeId,
  blocked: BlockOverlay,
  options: NearestUnblockedOptions = {},
): NodeId | null {
  const claimed = options.claimed ?? NO_NODES;
  const avoid = options.avoid ?? NO_NODES;
  const walls = options.walls ?? blocked;
  const traversal = options.traversal ?? 'land';
  const cap = options.cap ?? NEAREST_NODE_SEARCH_CAP;
  const free = (n: NodeId): boolean => !blocked.has(n) && !claimed.has(n) && !avoid.has(n);
  const open = ringSearch(
    terrain,
    from,
    cap,
    { accept: (n) => free(n) && hasOpenSide(terrain, n, walls, traversal) },
    traversal,
  );
  if (open !== null || options.sealedFallback !== true) return open;
  // A mover that must leave a body, a vehicle route or a taken goal is better off on a sealed node than
  // nowhere.
  return ringSearch(terrain, from, cap, { accept: free }, traversal);
}
