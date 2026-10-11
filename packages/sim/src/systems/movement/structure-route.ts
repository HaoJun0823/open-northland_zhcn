import type { World } from '../../ecs/world.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { GroupReachability } from './group-reachability.js';

const regions = new WeakMap<World, { terrain: TerrainGraph; reachability: GroupReachability }>();

/** Exact structural refusals shared by chasers and wall breakers. A closed gate's region is exhausted
 * once for the army, and forgotten as soon as any walk block changes. Unit bodies are not part of it. */
export function structureRouteSealed(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  start: NodeId,
  goal: NodeId,
): boolean {
  let held = regions.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, reachability: new GroupReachability(terrain) };
    regions.set(world, held);
  }
  const mask = walkBlockMask(world, ctx, terrain);
  const blocked = mask.levelled();
  if (held.reachability.unreachable(mask, blocked, start, goal)) return true;
  if (findPath(terrain, start, goal, blocked) !== null) return false;
  held.reachability.rememberFailure(mask, blocked, start, goal);
  return true;
}
