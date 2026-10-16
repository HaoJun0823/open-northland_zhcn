import type { Entity, World } from '../../ecs/world.js';
import { resourceOfGoodAtNode } from '../spatial/resources.js';

/**
 * The lowest-id standing resource of `goodType` whose node is exactly `(x, y)` (half-cell coords), or null:
 * the ground-drop to deposit work-cell join, run per pile candidate per gatherer scan, so it reads the
 * resource region index's node layer rather than scanning every resource on the map.
 */
export function resourceAtTile(world: World, x: number, y: number, goodType: number): Entity | null {
  return resourceOfGoodAtNode(world, x, y, goodType);
}
