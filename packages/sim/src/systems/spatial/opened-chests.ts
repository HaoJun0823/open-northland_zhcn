import { OpenedChest } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world opened-chest spatial index, so the placement-time razing scan reads only the open lids in
 * a building's reserved zone. An opened chest never moves, so the index updates only on create and
 * destroy.
 */
const index = createRegionIndex(
  OpenedChest,
  {
    verifier: 'openedChestRegionIndex',
    plural: 'opened chests',
    component: 'OpenedChest',
    singular: 'opened chest',
  },
  NO_REGION_EXTRA,
);

/** Every opened chest whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id.
 *  A candidate superset, so keep the caller's own zone-membership filter. */
export function openedChestsNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}

/** Every opened chest anchored exactly on `(hx, hy)`: the index's live bucket, so copy it before destroying. */
export function openedChestsAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return index.atNode(world, hx, hy);
}
