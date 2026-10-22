import type { Entity } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { worksFieldFromPost } from '../../../economy/haul-flag.js';
import { liveHaulFlag } from '../../../economy/work-flag.js';
import type { NavigationLimit } from '../../../signposts/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { IdleStands } from '../../planner/idle-replan.js';
import { interactionCell } from '../../targets/index.js';

/** Where a flagged carrier lifts loose goods: ranked from its flag, within the flag's Manhattan radius as a
 *  gatherer's work area is, and still inside the carrier's signpost confinement. */
export interface HaulFlagArea {
  readonly flag: Entity;
  readonly center: NodeId;
  readonly gate: SpatialGate;
}

/** The carrier's pickup area, or null while it holds no live flag. */
export function haulFlagArea(plan: PlannerContext): HaulFlagArea | null {
  const { world, terrain, limit } = plan;
  const live = liveHaulFlag(world, plan.entity);
  if (live === undefined) return null;
  const center = entityNode(world, terrain, live.flag);
  return { flag: live.flag, center, gate: workAreaGate(terrain, center, live.radius, limit) };
}

/** The nodes within Manhattan `radius` of `center`, as a gatherer's work area spans, and inside the
 *  carrier's signpost confinement. */
export function workAreaGate(
  terrain: TerrainGraph,
  center: NodeId,
  radius: number,
  limit: NavigationLimit | null,
): SpatialGate {
  const cx = terrain.xOf(center);
  const cy = terrain.yOf(center);
  return {
    bounds: { minX: cx - radius, maxX: cx + radius, minY: cy - radius, maxY: cy + radius },
    allowsNode: (node) =>
      Math.abs(terrain.xOf(node) - cx) + Math.abs(terrain.yOf(node) - cy) <= radius &&
      (limit === null || limit.allowsNode(node)),
  };
}

/** Walk to the flag and wait there: a flagged worker with nothing to do stays at its post in the field. */
export function waitAtHaulFlag(plan: PlannerContext, flag: Entity): void {
  const { world, ctx, terrain, entity, here } = plan;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, flag, here), () => {});
}

/** A posted gatherer, hunter or fisher that found no work waits at its flag, as a flagged carrier does. */
export function planWaitAtFieldFlag(plan: PlannerContext, idle: IdleStands): boolean {
  const { world, ctx, entity, jobType } = plan;
  if (!worksFieldFromPost(ctx.content, jobType)) return false;
  const live = liveHaulFlag(world, entity);
  if (live === undefined) return false;
  idle.stand(entity, false);
  waitAtHaulFlag(plan, live.flag);
  return true;
}
