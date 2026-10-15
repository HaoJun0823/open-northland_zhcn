import { HerdMember, Owner, Settler, YoungAnimal } from '../../components/index.js';
import { includesSortedId } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { herdParams } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import type { GrazingFields } from './grazing-fields.js';
import { herdGrid } from './herd-grid.js';
import { hasValidLeader, leadItself } from './herd-leader.js';
import { type HerdRoster, herdEligible, herdRoster } from './herd-roster.js';
import { ANIMAL_SPACING_NODES, nearHeld } from './spacing.js';
import { settlerMovementNode } from './traversal.js';

/** Original behavior: an animal without a leader looks for a herd, and gathers its own, within 40 map
 *  points. */
export const LEADER_SEARCH_RANGE = 40;

const idOf = (e: Entity): number => e;

/**
 * The leadership drive: an animal whose leader is gone (reaped, claimed, or never assigned) finds one on
 * the tick it notices.
 *
 * Original behavior: an animal of a `searchforleader` species, or any baby, joins the herd of a same-kind,
 * same-owner animal within 40 map points on its own island whose herd is below `maximumgroupsize`. Failing
 * that it leads itself, resets its grazing, and gathers the leaderless same-kind animals of its owner within
 * 40 map points, island or not, up to `maximumgroupsize`.
 *
 * Approximation: the original scans nearby animals in its sector order; here the herd with the nearest
 * member wins, ties to the lower leader id, and orphans are taken in ascending id. Both searches read the
 * herd grid's cells around the animal, not every herd.
 */
export const herdingSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  const roster = herdRoster(world);
  const dirty = roster.takeDirty();
  for (const e of dirty) {
    if (!world.isAlive(e) || !herdEligible(world, e) || hasValidLeader(world, e)) continue;
    findLeader(world, ctx, terrain, roster, e, dirty);
  }
};

function findLeader(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  roster: HerdRoster,
  e: Entity,
  orphans: readonly Entity[],
): void {
  const tribe = world.get(e, Settler).tribe;
  const herd = herdParams(ctx.content, tribe);
  if (herd === null) return;
  const here = settlerMovementNode(world, terrain, e);
  if (herd.searchForLeader || world.has(e, YoungAnimal)) {
    const joined = openHerdNear(world, terrain, roster, e, here, herd.maxGroupSize);
    if (joined !== null) {
      world.add(e, HerdMember, { leader: joined });
      roster.update();
      return;
    }
  }
  if (!leadItself(world, e, here, herd.maxGroupSize)) return;
  roster.update();
  const owner = world.tryGet(e, Owner)?.player;
  const near: Entity[] = [];
  const { x, y } = terrain.coordsOf(here);
  herdGrid(world, terrain).forEachNear(x, y, LEADER_SEARCH_RANGE, (c) => {
    if (c !== e && includesSortedId(orphans, c, idOf)) near.push(c);
  });
  near.sort((a, b) => a - b);
  for (const c of near) {
    if (roster.herdSize(e) >= herd.maxGroupSize) return;
    if (!world.isAlive(c) || !herdEligible(world, c) || hasValidLeader(world, c)) continue;
    if (world.get(c, Settler).tribe !== tribe || world.tryGet(c, Owner)?.player !== owner) continue;
    if (hexNodeDistance(terrain, settlerMovementNode(world, terrain, c), here) > LEADER_SEARCH_RANGE)
      continue;
    world.add(c, HerdMember, { leader: e });
    roster.update();
  }
}

/** The leader of the open same-kind, same-owner herd with a member nearest `e` on its island, or null. */
function openHerdNear(
  world: World,
  terrain: TerrainGraph,
  roster: HerdRoster,
  e: Entity,
  here: NodeId,
  maxGroupSize: number,
): Entity | null {
  const tribe = world.get(e, Settler).tribe;
  const owner = world.tryGet(e, Owner)?.player;
  const island = terrain.componentOf(here);
  let best: Entity | null = null;
  let bestDistance = 0;
  const { x, y } = terrain.coordsOf(here);
  herdGrid(world, terrain).forEachNear(x, y, LEADER_SEARCH_RANGE, (m) => {
    const leader = roster.leaderOf(m);
    if (leader === undefined || leader === e || roster.leaderOf(leader) !== leader) return;
    const at = settlerMovementNode(world, terrain, m);
    if (terrain.componentOf(at) !== island) return;
    const distance = hexNodeDistance(terrain, at, here);
    if (distance > LEADER_SEARCH_RANGE) return;
    if (best !== null && (distance > bestDistance || (distance === bestDistance && leader >= best))) return;
    if (roster.herdSize(leader) >= maxGroupSize) return;
    if (world.get(leader, Settler).tribe !== tribe || world.tryGet(leader, Owner)?.player !== owner) return;
    if (!hasValidLeader(world, leader)) return;
    bestDistance = distance;
    best = leader;
  });
  return best;
}

/** Landing spots ringing a leader, nearest first and in canonical order: every spot sits at least the
 *  stander spacing away. */
const FOLLOW_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 1],
  [-2, -1],
  [1, 2],
  [-1, -2],
  [2, -1],
  [-2, 1],
  [-1, 2],
  [1, -2],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

/** Where a follower walks to join its leader at `centre`: the first {@link FOLLOW_OFFSETS} spot inside
 *  `range` that is walkable, reachable from `from`, unblocked, and clear of standing animals' fields and of
 *  spots earlier followers took this tick. A radius under the stander spacing or a fully taken ring falls
 *  back to `centre` itself, so a follow always has a target. Approximation: the original paths onto the
 *  leader itself and stops once close enough. */
export function followSpot(
  terrain: TerrainGraph,
  fields: GrazingFields,
  taken: Set<NodeId>,
  blocked: BlockOverlay,
  from: NodeId,
  centre: NodeId,
  range: number,
  traversal: Traversal,
): NodeId {
  if (range < ANIMAL_SPACING_NODES) return centre; // too tight a radius to hold the spacing
  const at = terrain.coordsOf(centre);
  for (const [dx, dy] of FOLLOW_OFFSETS) {
    if (Math.abs(dx) + Math.abs(dy) > range) continue;
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const node = terrain.nodeAt(at.x + dx, at.y + dy);
    if (!terrain.traversable(node, traversal)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(from)) continue;
    if (blocked.has(node)) continue;
    if (fields.keeperNear(node) !== undefined || nearHeld(terrain, node, taken)) continue;
    taken.add(node);
    return node;
  }
  return centre;
}
