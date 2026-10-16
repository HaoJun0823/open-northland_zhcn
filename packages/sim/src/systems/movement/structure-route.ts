import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { GroupReachability } from './group-reachability.js';

/** Overlays the shared regions keep per walk-block version: every answer here is exact whatever is held. */
const MAX_HELD_OVERLAYS = 8;

const regions = new WeakMap<World, { terrain: TerrainGraph; reachability: GroupReachability }>();

function regionsOf(world: World, terrain: TerrainGraph): GroupReachability {
  let held = regions.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, reachability: new GroupReachability(terrain, MAX_HELD_OVERLAYS) };
    regions.set(world, held);
  }
  return held.reachability;
}

/** Whether a combat queue may occupy `node`: walkable ground outside closed gates and other structural
 * blocks. */
export function structureStandable(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  node: NodeId,
  blocked?: BlockOverlay,
): boolean {
  blocked ??= walkBlockMask(world, ctx, terrain).levelled();
  return regionsOf(world, terrain).standable(blocked, node);
}

/** Whether `a` and `b` are both {@link structureStandable} and joined by connected ground around
 * structures. */
export function structureSameRegion(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  a: NodeId,
  b: NodeId,
  blocked?: BlockOverlay,
): boolean {
  const mask = walkBlockMask(world, ctx, terrain);
  blocked ??= mask.levelled();
  return regionsOf(world, terrain).sameRegion(mask, blocked, a, b);
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
  const reachability = regionsOf(world, terrain);
  if (reachability.unreachable(mask, blocked, start, goal)) return true;
  if (findPath(terrain, start, goal, blocked) !== null) return false;
  reachability.rememberFailure(mask, blocked, start, goal);
  return true;
}
