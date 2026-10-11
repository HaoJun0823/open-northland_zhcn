import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

/** Authored outdoor placement: use the entrance or a free stand on the footprint perimeter.
 * Keep an arriving worshipper's stand stable; no original work-area coordinates are assumed. */
export function prayerStand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  entity: Entity,
  site: Entity,
  here: NodeId,
  spacing: PlannerSpacing,
  limit: NavigationLimit | null,
): NodeId | null {
  const blocked = spacing.blockedCells();
  const failed = unreachableGoals(world, ctx, entity);
  const component = terrain.componentOf(here);
  const usable = (cell: NodeId): boolean => {
    if (
      !terrain.isWalkable(cell) ||
      blocked.has(cell) ||
      spacing.isClaimed(cell) ||
      terrain.componentOf(cell) !== component ||
      isUnreachableGoal(failed, cell) ||
      (limit !== null && !limit.allowsNode(cell))
    )
      return false;
    const { x, y } = terrain.coordsOf(cell);
    return spacing.occupancy.at(x, y).every((occupant) => occupant === entity);
  };
  const door = interactionCell(world, ctx, terrain, site, here);
  const perimeter = spacing.workCells(site);
  if ((here === door || perimeter.includes(here)) && usable(here)) return here;
  if (usable(door)) return door;
  let nearest: NodeId | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const cell of perimeter) {
    if (!usable(cell)) continue;
    const gap = hexNodeDistance(terrain, here, cell);
    if (gap < distance || (gap === distance && (nearest === null || cell < nearest))) {
      nearest = cell;
      distance = gap;
    }
  }
  return nearest;
}
