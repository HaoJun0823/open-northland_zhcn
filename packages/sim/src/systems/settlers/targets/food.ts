import { BUILDING_KIND } from '@open-northland/data';
import { BerryBush, Building, ownerOf, sameSideAs } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { lowestStockedFood } from '../../family/food-sources.js';
import { builtHomeType, homeUsedBy } from '../../family/households.js';
import { routeRegions } from '../../footprint/index.js';
import type { SupplyTally } from '../../stores/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import type { TargetCandidates } from './candidates.js';
import type { Qualified } from './cell-index.js';
import { unclaimedGoodsAt } from './stores/stock.js';

/**
 * A store's candidate food good: its lowest-goodType stocked edible, or null when it holds none or has
 * no `Stockpile` at all. Canonical order, and side-effect-free so the ring may re-evaluate it on
 * the fallback scan.
 *
 * Edibility is judged on the good's edible form, since consuming a stocked dish is itself the
 * conversion. The returned type is the raw one, which is what comes off the shelf. The family's
 * {@link lowestStockedFood} is the same pick; a store with no shelf at all answers null.
 *
 * Given `claims`, a good whose every unit here is claimed by a settler walking to take it is passed over.
 */
export function storedFoodGood(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  claims?: SupplyTally,
): number | null {
  const unclaimed = claims === undefined ? undefined : unclaimedGoodsAt(world, ctx, claims, entity);
  return lowestStockedFood(world, ctx.content, entity, unclaimed);
}

/** Source-specific serving details; distance, confinement and reachability are shared. */
type Meal =
  | { readonly kind: 'store'; readonly goodType: number; readonly atHome: boolean }
  | { readonly kind: 'bush' };

const RIPE_BUSH: Qualified<Meal> = { payload: { kind: 'bush' } };

type FoodTarget = (
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number; readonly atHome: boolean }
  | { readonly kind: 'bush'; readonly bush: Entity }
) & { readonly cell: NodeId; readonly distance: number };

/**
 * Project rule: every meal competes by Manhattan distance, then cell and entity id, inside the eater's
 * walking area. There is no transport range, bush-only radius or home-first preference. Only serving
 * differs: a ripe bush is foraged, a stockpile supplies an unclaimed edible, and the eater's own built
 * home admits it indoors. Other families' larders and another player's stocks remain private.
 */
export function nearestFood(
  targets: TargetCandidates,
  world: World,
  ctx: SystemContext,
  supply: SupplyTally,
  terrain: TerrainGraph,
  here: NodeId,
  eater: Entity,
  gate?: SpatialGate,
): FoodTarget | null {
  const memo = unreachableGoals(world, ctx, eater);
  const component = terrain.componentOf(here);
  const regions = routeRegions(world, ctx, terrain);
  const home = homeUsedBy(world, ctx, eater);
  const onSide = sameSideAs(world, ownerOf(world, eater));
  const buildings = contentIndex(ctx.content).buildings;
  const accept = (source: Entity): Qualified<Meal> | null => {
    const bush = world.tryGet(source, BerryBush);
    if (bush?.stage === 'ripe') return RIPE_BUSH;
    if (!onSide(source)) return null;
    const building = world.tryGet(source, Building);
    const atHome =
      building !== undefined && buildings.get(building.buildingType)?.kind === BUILDING_KIND.home;
    if (atHome && (source !== home || builtHomeType(world, ctx, source) === undefined)) return null;
    const goodType = storedFoodGood(world, ctx, source, supply);
    return goodType === null ? null : { payload: { kind: 'store', goodType, atHome } };
  };
  const avoid = (cell: NodeId): boolean =>
    terrain.componentOf(cell) !== component ||
    !regions.standable(cell) ||
    regions.unroutable(here, cell) ||
    isUnreachableGoal(memo, cell);
  const winner = targets.mealCells.nearest(here, accept, gate, avoid);
  if (winner === null) return null;
  const { entity, cell, distance, payload } = winner;
  return payload.kind === 'bush'
    ? { kind: 'bush', bush: entity, cell, distance }
    : { ...payload, store: entity, cell, distance };
}
