import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';

const NO_BLOCKS: BlockOverlay = { has: () => false, size: 0 };

/** The costs a Dijkstra over the graph's own steps settles from `seed` under `blocked`, in ascending
 *  (cost, node id) order, the first `budget` of them: the oracle the lattice metrics and the walk flood
 *  must match, written as plainly as it reads. */
export function stepDijkstra(
  terrain: TerrainGraph,
  seed: NodeId,
  blocked: BlockOverlay = NO_BLOCKS,
  budget = Number.POSITIVE_INFINITY,
): Map<NodeId, number> {
  const settled = new Map<NodeId, number>();
  const best = new Map<NodeId, number>([[seed, 0]]);
  while (settled.size < budget) {
    let next: NodeId | undefined;
    let nextCost = Number.POSITIVE_INFINITY;
    for (const [node, cost] of best) {
      if (cost < nextCost || (cost === nextCost && next !== undefined && node < next)) {
        next = node;
        nextCost = cost;
      }
    }
    if (next === undefined) break;
    best.delete(next);
    settled.set(next, nextCost);
    for (const step of terrain.steps(next, blocked)) {
      if (settled.has(step.node)) continue;
      const cost = nextCost + step.cost;
      if (cost < (best.get(step.node) ?? Number.POSITIVE_INFINITY)) best.set(step.node, cost);
    }
  }
  return settled;
}
