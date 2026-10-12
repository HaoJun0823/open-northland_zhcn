import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { GroupReachability } from './group-reachability.js';

const regions = new WeakMap<
  World,
  {
    terrain: TerrainGraph;
    reachability: WeakMap<BlockOverlay, GroupReachability>;
  }
>();

function regionsOf(world: World, terrain: TerrainGraph, blocked: BlockOverlay): GroupReachability {
  let held = regions.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, reachability: new WeakMap() };
    regions.set(world, held);
  }
  let reachability = held.reachability.get(blocked);
  if (reachability === undefined) {
    reachability = new GroupReachability(terrain);
    held.reachability.set(blocked, reachability);
  }
  return reachability;
}

/** The connected ground a combat queue may occupy, including closed gates and other structural blocks. */
export function structureRegionOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  node: NodeId,
  blocked?: BlockOverlay,
): number | null {
  const mask = walkBlockMask(world, ctx, terrain);
  blocked ??= mask.levelled();
  return regionsOf(world, terrain, blocked).regionOf(mask, blocked, node);
}

/** Exact structural refusals shared by chasers and wall breakers. A closed gate's region is exhausted
 * once for the army, and forgotten as soon as any walk block changes. Unit bodies are not part of it. */
export function structureRouteSealed(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  start: NodeId,
  goal: NodeId,
  blocked?: BlockOverlay,
): boolean {
  const mask = walkBlockMask(world, ctx, terrain);
  blocked ??= mask.levelled();
  const reachability = regionsOf(world, terrain, blocked);
  if (reachability.unreachable(mask, blocked, start, goal)) return true;
  if (findPath(terrain, start, goal, blocked) !== null) return false;
  reachability.rememberFailure(mask, blocked, start, goal);
  return true;
}
