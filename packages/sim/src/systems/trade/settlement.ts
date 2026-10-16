import { BUILDING_KIND } from '@open-northland/data';
import { Building, ownerOf } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { FetchableStock } from '../settlers/targets/index.js';
import { goodsSearchLimitAt } from '../signposts/reach.js';
import { isWorkplaceOutput } from '../stores/index.js';
import { sameFoodClass } from './goods.js';

/** Whether a stop at `house` may load out of its settlement: the house is a storehouse. */
export function isSettlementAnchor(world: World, ctx: ContentContext, house: Entity): boolean {
  const type = world.tryGet(house, Building)?.buildingType;
  return type !== undefined && contentIndex(ctx.content).buildings.get(type)?.kind === BUILDING_KIND.storage;
}

/**
 * The houses of `anchor`'s settlement besides it and `exclude` that hold `good` or a dish of its edible
 * class, ascending by id: the trader's own finished storehouses, and workshops whose output the good is,
 * whose door the goods search from the anchor's door reaches, the reach a porter there fetches through.
 * With signpost navigation off that search sets no bound, so every such house of the player counts.
 */
export function settlementHouses(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  anchor: Entity,
  exclude: Entity,
  good: number,
): Entity[] {
  const player = ownerOf(world, trader);
  const anchorDoor = interactionNodeId(world, ctx, terrain, anchor);
  if (player === undefined || anchorDoor === null) return [];
  const reach = goodsSearchLimitAt(
    world,
    ctx.content,
    terrain,
    player,
    terrain.xOf(anchorDoor),
    terrain.yOf(anchorDoor),
  );
  const ledger = FetchableStock.of(world, ctx);
  const found = new Set<Entity>();
  for (const { typeId: form } of ctx.content.goods) {
    if (!sameFoodClass(ctx, form, good)) continue;
    for (const house of ledger.holders(form)) {
      if (house === anchor || house === exclude || found.has(house)) continue;
      if (ownerOf(world, house) !== player || !lendsToSettlement(world, ctx, house, form)) continue;
      const door = interactionNodeId(world, ctx, terrain, house);
      if (door !== null && (reach === null || reach.allowsNode(door))) found.add(house);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function lendsToSettlement(world: World, ctx: SystemContext, house: Entity, good: number): boolean {
  const building = world.tryGet(house, Building);
  if (building === undefined || building.built !== ONE) return false;
  const kind = contentIndex(ctx.content).buildings.get(building.buildingType)?.kind;
  if (kind === BUILDING_KIND.storage) return true;
  return kind === BUILDING_KIND.workplace && isWorkplaceOutput(world, ctx, house, good);
}
