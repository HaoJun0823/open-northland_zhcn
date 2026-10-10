import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  markTributePaid,
  ownerOf,
  Stockpile,
  type TributeDemand,
  tributeSlot,
  unpaidTributes,
} from '../../components/index.js';
import type { TributeCommand } from '../../core/commands/tribute.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/buildings.js';
import { edibleClassOf, edibleGoodFormOf } from '../readviews/food.js';
import { countsAsOwnStock, stockOf, takeStock } from './stock.js';

/** One open, unpaid tribute as the diplomacy window lists it: each demand with what the payer's
 *  stores hold toward it between them, and whether every demand is covered so, each counted on its
 *  own, which a payment can still fall short of. */
export interface OpenTribute {
  readonly slot: number;
  readonly receiver: number;
  readonly stringId: number;
  readonly demands: readonly {
    readonly good: number;
    readonly amount: number;
    readonly onHand: number;
  }[];
  readonly payable: boolean;
}

interface PayingHouse {
  readonly entity: Entity;
  readonly buildingType: number;
}

const byEntity = (a: PayingHouse, b: PayingHouse): number => a.entity - b.entity;

/**
 * The payer's finished houses in the order a tribute is counted over and drained from: its first
 * headquarters, then its other storages, then its workplaces, each group ascending by id (reading of
 * the original's payment, which takes the headquarters type first, then every warehouse, then every
 * workplace in array order).
 */
function payingHouses(world: World, ctx: ContentContext, payer: number): PayingHouse[] {
  const headquarters: PayingHouse[] = [];
  const storages: PayingHouse[] = [];
  const workplaces: PayingHouse[] = [];
  const buildings = contentIndex(ctx.content).buildings;
  for (const entity of world.query(Building, Stockpile)) {
    const building = world.get(entity, Building);
    if (building.built !== ONE || ownerOf(world, entity) !== payer) continue;
    const type = buildings.get(building.buildingType);
    const house = { entity, buildingType: building.buildingType };
    if (type?.kind === BUILDING_KIND.storage) {
      (type.id === HEADQUARTERS_BUILDING_ID ? headquarters : storages).push(house);
    } else if (type?.kind === BUILDING_KIND.workplace) workplaces.push(house);
  }
  const first = headquarters.sort(byEntity).slice(0, 1);
  const rest = headquarters.slice(1).concat(storages).sort(byEntity);
  return first.concat(rest, workplaces.sort(byEntity));
}

/**
 * The good a house answers a demand for `good` with, or undefined when it stocks none as its own. A
 * dish or an edible is met by the first good of its edible class the house stocks, the edible before
 * the dishes ascending by typeId, so a warehouse pays bread out of its `food_simple` and the bakery
 * out of its bread (reading of the original's food lookup); any other good only by itself.
 */
function stockedFormOf(ctx: ContentContext, buildingType: number, good: number): number | undefined {
  const edibleClass = edibleClassOf(ctx.content, edibleGoodFormOf(ctx.content, good));
  for (const candidate of edibleClass.length > 0 ? edibleClass : [good]) {
    if (countsAsOwnStock(ctx, buildingType, candidate)) return candidate;
  }
  return undefined;
}

function onHandAt(world: World, ctx: ContentContext, house: PayingHouse, good: number): number {
  const stocked = stockedFormOf(ctx, house.buildingType, good);
  return stocked === undefined ? 0 : stockOf(world, house.entity, stocked);
}

function onHandOver(world: World, ctx: ContentContext, houses: readonly PayingHouse[], good: number): number {
  let total = 0;
  for (const house of houses) total += onHandAt(world, ctx, house, good);
  return total;
}

/**
 * Whether the payer's houses hold every demand between them, each demand summed over every house on
 * its own. Original behavior: two demands one house answers with the same stocked good both count
 * that stock in full, so such a slot can read payable and still fall short when paid.
 */
function payable(
  world: World,
  ctx: ContentContext,
  houses: readonly PayingHouse[],
  demands: DeepReadonly<TributeDemand[]>,
): boolean {
  return demands.every((demand) => onHandOver(world, ctx, houses, demand.good) >= demand.amount);
}

/**
 * Take the demands out of `houses` in order, each house giving what it holds of what is still owed,
 * until every demand is met. Returns whether they were; the goods taken stay taken either way.
 */
function drain(
  world: World,
  ctx: ContentContext,
  houses: readonly PayingHouse[],
  demands: DeepReadonly<TributeDemand[]>,
): boolean {
  const owed = demands.map((demand) => ({ good: demand.good, amount: demand.amount }));
  for (const house of houses) {
    for (const demand of owed) {
      if (demand.amount <= 0) continue;
      const stocked = stockedFormOf(ctx, house.buildingType, demand.good);
      if (stocked === undefined) continue;
      const take = Math.min(stockOf(world, house.entity, stocked), demand.amount);
      if (take > 0) takeStock(world, house.entity, stocked, take);
      demand.amount -= take;
    }
    if (owed.every((demand) => demand.amount <= 0)) return true;
  }
  return false;
}

/** The `payTribute` command: once the slot reads {@link payable}, {@link drain} the payer's houses in
 *  {@link payingHouses} order and mark the slot paid when the drain covered it. */
export function payTribute(world: World, ctx: ContentContext, command: TributeCommand): void {
  const held = tributeSlot(world, command.slot);
  if (held === undefined || held.payer !== command.player || !held.active || held.paid) return;
  const houses = payingHouses(world, ctx, held.payer);
  if (!payable(world, ctx, houses, held.demands)) return;
  if (drain(world, ctx, houses, held.demands)) markTributePaid(world, command.slot);
}

/** The open, unpaid tributes `payer` owes, ascending by slot, as detached copies. */
export function openTributes(world: World, ctx: ContentContext, payer: number): OpenTribute[] {
  const unpaid = unpaidTributes(world, payer);
  if (unpaid.length === 0) return [];
  const houses = payingHouses(world, ctx, payer);
  return unpaid.map(({ slot, tribute }) => ({
    slot,
    receiver: tribute.receiver,
    stringId: tribute.stringId,
    demands: tribute.demands.map((demand) => ({
      good: demand.good,
      amount: demand.amount,
      onHand: onHandOver(world, ctx, houses, demand.good),
    })),
    payable: payable(world, ctx, houses, tribute.demands),
  }));
}
