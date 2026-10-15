import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { openedChestsNearNode } from '../spatial/opened-chests.js';
import { stumpsNearNode } from '../spatial/stumps.js';
import { decorInReservedZone } from './reserved-decor.js';

/**
 * Clear every felled-tree stump and opened chest standing inside `building`'s reserved build-exclusion
 * zone: neither blocks placement, so either would otherwise be drawn straight through the walls. Original
 * behavior: a house clears every landscape object under its body when placed and when an upgrade
 * finishes, an opened chest's void-type placement included. Clearing the whole reserved zone follows the
 * observed berry-razing rule.
 *
 * No razed event is emitted, unlike the bush pass: both are live snapshot-drawn entities, so a destroy
 * drops them from the snapshot and the sprite pool reaps their quads.
 */
export function destroyInertDecorInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const near of [stumpsNearNode, openedChestsNearNode]) {
    for (const e of decorInReservedZone(world, ctx, building, near)) world.destroy(e);
  }
}
