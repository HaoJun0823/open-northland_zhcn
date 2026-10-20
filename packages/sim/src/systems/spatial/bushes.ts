import { BerryBush } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world berry-bush spatial index for local landscape queries. Foraging and regrowth change
 * ripeness, not location, so the index updates only on membership changes.
 */
const index = createRegionIndex(
  BerryBush,
  { verifier: 'bushRegionIndex', plural: 'bushes', component: 'BerryBush', singular: 'bush' },
  NO_REGION_EXTRA,
);

/** Every berry bush whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id. */
export function bushesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}

/** Every berry bush anchored exactly on `(hx, hy)`. Not a copy; see `RegionIndex.atNode`. */
export function bushesAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return index.atNode(world, hx, hy);
}
