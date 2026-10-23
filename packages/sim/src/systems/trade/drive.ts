import {
  Building,
  dropFallenTradeStops,
  isForeignHouse,
  TRADE_LIMIT_NONE,
  TRADE_ROUTE_HOUSES,
  type TradeAgreement,
  type TradeImportMark,
  TradeRoute,
  type TradeRouteView,
  type TradeStop,
  VehicleDrive,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { buildingDoorwayNodes, interactionNode, vehicleAnchor } from '../footprint/index.js';
import { countsAsOwnStock, roomFor, stockOf, typeStoresGood } from '../missions/stock.js';
import { atomicDuration } from '../readviews/animations.js';
import { edibleGoodFormOf, isFoodKeptAtHome } from '../readviews/food.js';
import { isTraderJob } from '../readviews/jobs.js';
import { atOrWalk, collectAtomicOf, PILEUP_ATOMIC_ID, startAtomic } from '../settlers/atomics/start.js';
import type { PlannerContext } from '../settlers/planner/context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { LendableTally, storageLendable } from '../settlers/targets/stores/storage-reserve.js';
import { isUnreachableGoal, noteUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { mayFetchGoodFrom } from '../stores/index.js';
import { releaseRider } from '../vehicles/crew.js';
import { nodeOf, sendVehicleTo, snapVehicleTarget } from '../vehicles/movement.js';
import { activeAgreement } from './agreements.js';
import { type CartHold, cartHoldOf, type TradeCart, tradeCartOf } from './cart.js';
import { sameFoodClass } from './goods.js';
import { refillRestores } from './partner-stock.js';
import { settlementHouses } from './settlement.js';

/** How close to the stop's door the cart must stand before the trader works the stop, in map-point
 *  steps (original behavior: a hexagon distance over 5 moves the cart). */
export const TRADE_CART_HOUSE_DISTANCE = 5;

/** How far around the door the cart's move point is looked for, in hexagon rings
 *  (original behavior: radius 20). */
export const TRADE_CART_SEARCH_RADIUS = 20;

/** A unit the trader moves at a stop: loaded out of `from`, the stop's house or a house of its
 *  settlement, or unloaded into the stop's house. */
type StopWork =
  | { readonly kind: 'load'; readonly good: number; readonly from: Entity }
  | { readonly kind: 'unload'; readonly good: number; readonly into: Entity | null };

type NextStop = { readonly kind: 'next' };

/** What the trader does next at its current stop. */
type TradeAction = StopWork | NextStop | { readonly kind: 'wait' };

const NEXT: NextStop = { kind: 'next' };
const WAIT: TradeAction = { kind: 'wait' };

/** The stop the trader loads at, with what choosing a source there reads. `exclude` is the other stop's
 *  house, which a settlement never loads out of. */
interface LoadScope {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly trader: Entity;
  readonly cart: TradeCart;
  readonly stop: DeepReadonly<TradeStop>;
  readonly exclude: Entity;
}

/**
 * TRADER - a trader commanding a cart with a valid route works it: it moves the cart to within
 * {@link TRADE_CART_HOUSE_DISTANCE} of each stop, then at the stop unloads what the stop takes and loads
 * what the other stop wants, and moves the cart over. Between the player's own houses the import marks
 * decide what moves; at a foreign house the chosen agreement does, give first, then take. A trader with
 * fewer than two standing houses, or a foreign stop with no valid agreement, is left to the rider rung;
 * one with no cart to command idles on foot (the HUD's `noVehicleForWork` note reads that state). While
 * the cart is under way or holds a goal for its crew the rider rung boards the trader, and the cart's
 * arrival sets it down again (`traderDisembarkSystem`). Original behavior of the trader's job.
 * Approximation: the original's trader carries every unit between the house and the cart's door on its
 * back; here the load and unload clips at the house move the unit straight into and out of the hold.
 */
export function planTrader(plan: PlannerContext): boolean {
  const { world, ctx, entity: e } = plan;
  if (!isTraderJob(ctx.content, plan.jobType)) return false;
  if (!world.has(e, TradeRoute) || !routeStandsFinished(world, e)) return false;
  const cart = tradeCartOf(world, ctx, e);
  if (cart === null || cartUnderWay(world, cart)) return false;
  if (world.get(e, TradeRoute).current < 0) world.mut(e, TradeRoute).current = 0;
  const current = world.get(e, TradeRoute);
  const stop = current.stops[current.current];
  const other = current.stops[1 - current.current];
  if (stop === undefined || other === undefined) return false;

  const hold = cartHoldOf(world, ctx, cart);
  const scope = loadScope(plan, cart, stop, other);
  const action = decide(scope, current, hold, other);
  switch (action.kind) {
    case 'wait':
      return false;
    case 'load':
    case 'unload':
      return workStop(plan, cart, stop.house, action);
    case 'next':
      break;
  }
  if (!isForeignHouse(world, e, stop.house) && !isForeignHouse(world, e, other.house)) {
    // Original behavior: an own stop with nothing to move hands the turn to the other one, and the cart
    // drives only once that stop has a unit to load or unload.
    const there = decideDomestic(loadScope(plan, cart, other, stop), hold, stop);
    if (there.kind === 'next') return false;
    world.mut(e, TradeRoute).current = 1 - current.current;
    return workStop(plan, cart, other.house, there);
  }
  if (!cartNearHouse(world, ctx, cart, other.house) && !driveCartTo(plan, cart, other.house, false)) {
    return false;
  }
  world.mut(e, TradeRoute).current = 1 - current.current;
  return true;
}

function loadScope(
  plan: PlannerContext,
  cart: TradeCart,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): LoadScope {
  const { world, ctx, terrain, entity: trader } = plan;
  return { world, ctx, terrain, trader, cart, stop, exclude: other.house };
}

/** Move one unit at the stop whose house is `stopHouse`: bring the cart within reach of the house the
 *  unit moves at first, then walk over and load or unload. */
function workStop(plan: PlannerContext, cart: TradeCart, stopHouse: Entity, work: StopWork): boolean {
  const { world, ctx, entity: e } = plan;
  const house = work.kind === 'load' ? work.from : stopHouse;
  if (!cartNearHouse(world, ctx, cart, house)) return driveCartTo(plan, cart, house, house !== stopHouse);
  walkTo(plan, house, () => {
    if (work.kind === 'load') {
      const atomicId = collectAtomicOf(world, ctx, house);
      startAtomic(
        world,
        e,
        atomicId,
        { kind: 'cartLoad', from: house, goodType: work.good },
        atomicDuration(ctx.content, plan, atomicId),
        house,
      );
      return;
    }
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'cartUnload', store: work.into, goodType: work.good },
      atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID),
      work.into,
    );
  });
  return true;
}

/** Whether the cart drives or holds a goal until its crew is in: the trader rides along, not works. */
function cartUnderWay(world: World, cart: TradeCart): boolean {
  return world.has(cart.vehicle, VehicleDrive) || cart.state.heldGoal !== null;
}

function houseDoor(world: World, ctx: SystemContext, house: Entity): HalfCellNode | null {
  const door = interactionNode(world, ctx, house);
  return door === null ? null : { hx: door.x, hy: door.y };
}

/** The node the trader's failed-goal memo keys a house's door by. */
function doorGoal(terrain: TerrainGraph, door: HalfCellNode): NodeId {
  return terrain.nodeAtClamped(door.hx, door.hy);
}

/** Whether the cart stands within {@link TRADE_CART_HOUSE_DISTANCE} steps of the house's door. */
function cartNearHouse(world: World, ctx: SystemContext, cart: TradeCart, house: Entity): boolean {
  const anchor = vehicleAnchor(world, cart.vehicle);
  const door = houseDoor(world, ctx, house);
  return anchor !== null && door !== null && hexDistance(anchor, door) <= TRADE_CART_HOUSE_DISTANCE;
}

/**
 * Original behavior: order the cart to the first node in ring order around the house's
 * door, out to {@link TRADE_CART_SEARCH_RADIUS}, that the cart may stand on and that is no house's door
 * (here no carved door passage either) nor the stop's own work point, as a goto the cart holds until the trader boards. When no such node lies within the working distance
 * of the door the trader lets go of the cart and stays on foot (approximation: the original detaches
 * through the detach command with its own note; here the trader's idle-without-a-cart state is what the
 * player sees). A node the cart has no route to keeps the trader seated: the door goes into its
 * failed-goal memo and the search waits the memo out (the original re-aims the vehicle behind its
 * `vehicleNoPath` note and the trader keeps trying). A settlement house the cart finds no place at goes
 * into the memo too, so the trader loads elsewhere meanwhile and keeps its cart. True when the order
 * stands.
 */
function driveCartTo(
  plan: PlannerContext,
  cart: TradeCart,
  house: Entity,
  settlementHouse: boolean,
): boolean {
  const { world, ctx, terrain, entity: e } = plan;
  const door = houseDoor(world, ctx, house);
  if (door === null) return false;
  const doorNode = doorGoal(terrain, door);
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), doorNode)) return false;
  const doors = buildingDoorwayNodes(world, ctx, terrain);
  // A house with no authored door is worked at its anchor, which the cart leaves free like a door.
  const goal = snapVehicleTarget(world, ctx, terrain, cart.vehicle, door, {
    radius: TRADE_CART_SEARCH_RADIUS,
    exclude: (node) => node === doorNode || doors.has(node),
  });
  const point = goal === null ? null : nodeOf(terrain, goal);
  if (goal === null || point === null || hexDistance(point, door) > TRADE_CART_HOUSE_DISTANCE) {
    if (settlementHouse) noteUnreachableGoal(world, ctx, e, doorNode);
    else releaseRider(world, e, cart.vehicle);
    return false;
  }
  if (!sendVehicleTo(world, ctx, terrain, cart.vehicle, goal)) {
    noteUnreachableGoal(world, ctx, e, doorNode);
    return false;
  }
  return true;
}

function walkTo(plan: PlannerContext, house: Entity, start: () => void): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, house, here), start);
}

/** Drop the stops whose house fell; reports whether a full route of finished houses is left to work. A
 *  house being upgraded holds the trader until it stands finished again. */
function routeStandsFinished(world: World, e: Entity): boolean {
  dropFallenTradeStops(world, e);
  const { stops } = world.get(e, TradeRoute);
  return (
    stops.length === TRADE_ROUTE_HOUSES &&
    stops.every((stop) => world.get(stop.house, Building).built === ONE)
  );
}

function decide(
  scope: LoadScope,
  route: TradeRouteView,
  hold: CartHold,
  other: DeepReadonly<TradeStop>,
): TradeAction {
  const { world, ctx, trader, stop } = scope;
  const foreign = isForeignHouse(world, trader, stop.house);
  if (!foreign && !isForeignHouse(world, trader, other.house)) return decideDomestic(scope, hold, other);
  const agreement = activeAgreement(world, trader, route);
  if (agreement === undefined) return WAIT;
  return foreign
    ? decideExchange(world, ctx, trader, route, hold, stop.house, agreement)
    : decidePreparation(scope, route, hold, agreement);
}

/**
 * At the player's own house before a foreign trip: clear the cart of everything but the give good into
 * the house, then load give goods while the cart has room for the whole exchange and the house (or its
 * settlement) has spare; leave once a batch is aboard. Original behavior (reading): the room test keeps
 * space for the take goods every aboard batch will bring back. The player's two limits are this
 * build's own (owner's choice): the give goods load only above `giveKeep`, and no batch starts once the
 * take goods at home plus what the batches aboard bring back reach `takeUpTo`.
 */
function decidePreparation(
  scope: LoadScope,
  route: TradeRouteView,
  hold: CartHold,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const { world, ctx, stop } = scope;
  const stray = hold.entries.find(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
  if (stray !== undefined) return unloadInto(world, ctx, stop.house, stray[0]);
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const give = Math.max(1, agreement.giveAmount);
  const extra = Math.max(0, agreement.takeAmount - agreement.giveAmount);
  const batchesAboard = Math.floor(aboard / give);
  const toCompleteBatch = give - (aboard % give);
  const roomNeeded = (batchesAboard + 1) * extra + toCompleteBatch;
  const startsBatch = aboard % give === 0;
  const filled =
    startsBatch &&
    route.takeUpTo !== TRADE_LIMIT_NONE &&
    homeStockOf(scope, agreement.takeGood) + batchesAboard * agreement.takeAmount >= route.takeUpTo;
  if (roomNeeded <= hold.room && !filled && !isFoodKeptAtHome(world, ctx, stop.house, agreement.giveGood)) {
    const source = loadSourceOf(scope, agreement.giveGood, route.giveKeep);
    if (source !== undefined && hold.carries(source.good)) return { kind: 'load', ...source };
  }
  return aboard >= agreement.giveAmount ? NEXT : WAIT;
}

/**
 * At the foreign house: hand the give goods over one by one, then take the agreed goods aboard, then
 * start over while another batch is aboard; go home when the cart runs out or fills up, or when the
 * house runs out of the take good mid-batch (what was handed over stays given, as the original's goods
 * vanish into the house). Nothing is handed over while the house holds fewer take goods than one batch
 * pays out, where the original delivers regardless: the trader waits at the house for its seat's refill
 * instead, so one trip sells the whole load (owner's choice). At a house no refill tops up again, whose
 * take good the cart cannot carry, or with no room for the give good, a trader with only give goods
 * aboard waits there, one with anything else aboard carries it home first.
 */
function decideExchange(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  route: TradeRouteView,
  hold: CartHold,
  house: Entity,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const stocked = stockedFormAt(world, ctx, house, agreement.takeGood);
  const onOffer =
    stocked === undefined
      ? 0
      : Math.min(stockOf(world, house, stocked), storageLendable(world, ctx, house, stocked));
  if (route.given < agreement.giveAmount) {
    if (aboard + route.given < agreement.giveAmount) return NEXT;
    const otherAboard = hold.entries.some(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
    // A cart whose hold cannot take the take good would hand the give goods over for nothing.
    if (stocked !== undefined && !hold.carries(stocked)) return otherAboard ? NEXT : WAIT;
    if (route.given === 0 && onOffer < agreement.takeAmount) {
      if (refillRestores(world, ctx, house, agreement.takeGood, agreement.takeAmount)) return WAIT;
      return otherAboard ? NEXT : WAIT;
    }
    // The cart holds a dish as its edible, so the unit handed over is whichever aboard good the
    // agreement's give good matches.
    const giving = hold.entries.find(([good]) => sameFoodClass(ctx, good, agreement.giveGood));
    if (giving === undefined) return NEXT;
    const slot = storableFormAt(world, ctx, house, giving[0]);
    // A house with no room for the give good: driving home with only give goods aboard brings the same
    // load straight back.
    if (slot === undefined || roomFor(world, ctx, house, slot) <= 0) return otherAboard ? NEXT : WAIT;
    return { kind: 'unload', good: giving[0], into: house };
  }
  if (route.received < agreement.takeAmount) {
    if (hold.room <= 0) return NEXT;
    if (stocked === undefined || !hold.carries(stocked) || onOffer <= 0) {
      resetExchange(world, trader);
      return NEXT;
    }
    return { kind: 'load', good: stocked, from: house };
  }
  resetExchange(world, trader);
  return aboard >= agreement.giveAmount
    ? decideExchange(world, ctx, trader, world.get(trader, TradeRoute), hold, house, agreement)
    : NEXT;
}

/** The units aboard that answer for `good`: the good itself, or a dish's edible form of its class. */
function aboardOfClass(ctx: ContentContext, hold: CartHold, good: number): number {
  let total = 0;
  for (const [aboard, amount] of hold.entries) if (sameFoodClass(ctx, aboard, good)) total += amount;
  return total;
}

function resetExchange(world: World, trader: Entity): void {
  const live = world.mut(trader, TradeRoute);
  live.given = 0;
  live.received = 0;
}

/**
 * Between the player's own houses the import marks decide what moves (original behavior, except where
 * noted):
 * - A good marked at this stop and not at the other is unloaded here; one marked at the other stop only
 *   stays aboard for it; one neither stop marks is unloaded at the first stop that stores it.
 * - A good marked at the other stop only is loaded while this stop has a spare unit and the other has
 *   room for it beside what is aboard; a settlement stop loads it out of its whole settlement.
 * - A good both stops mark is balanced: it is loaded while this stop holds more than the other plus
 *   what is aboard, and unloaded while the other stop holds more (score `(here - there - aboard) / 2`).
 * - A mark limits the flow into its own stop: nothing is unloaded there once the stop holds `upTo`
 *   units, nothing is loaded for it once its stock plus what is aboard reaches `upTo`, and loading for
 *   it leaves `keep` units in the other stop. A balanced good is two such flows, each limited by the
 *   mark at the stop it flows into. Approximation: `keep` stands in for the original's per-house
 *   minimum stock setting, and the `upTo` ceiling is this build's own addition (owner's choice).
 * - With no mark on either stop nothing moves. The original then balances every good; this build waits
 *   for the player's marks instead (owner's choice).
 * Food is never taken out of a home. Approximations: the original ranks candidates by the houses'
 * request counters, which this build does not keep, so the lowest good id goes first; and it keeps
 * "home enhancer" goods out of a home, a good class the content does not flag.
 */
function decideDomestic(
  scope: LoadScope,
  hold: CartHold,
  other: DeepReadonly<TradeStop>,
): StopWork | NextStop {
  const { world, ctx, stop } = scope;
  const markOf = (at: DeepReadonly<TradeStop>, good: number): TradeImportMark | undefined => {
    const edible = edibleGoodFormOf(ctx.content, good);
    return at.imports.find((mark) => mark.good === good || mark.good === edible);
  };
  const hereType = world.get(stop.house, Building).buildingType;

  for (const [good, aboard] of hold.entries) {
    const slot = storableFormAt(world, ctx, stop.house, good);
    if (slot === undefined || roomFor(world, ctx, stop.house, slot) <= 0) continue;
    const wantedHere = markOf(stop, good);
    const wantedThere = markOf(other, good);
    if (wantedThere !== undefined && wantedHere === undefined) continue;
    if (wantedHere !== undefined && reachesCeiling(wantedHere, stockOf(world, stop.house, slot))) continue;
    if (wantedHere !== undefined && wantedThere !== undefined) {
      const there = storableFormAt(world, ctx, other.house, good);
      const shortfall =
        (there === undefined ? 0 : stockOf(world, other.house, there)) - stockOf(world, stop.house, slot);
      if (there !== undefined && Math.floor((aboard + shortfall) / 2) <= 0) continue;
    }
    return { kind: 'unload', good, into: stop.house };
  }

  if (hold.room <= 0) return NEXT;
  for (const good of ownGoodsOf(ctx, hereType)) {
    const wantedThere = markOf(other, good);
    if (wantedThere === undefined || isFoodKeptAtHome(world, ctx, stop.house, good)) continue;
    const carried = edibleGoodFormOf(ctx.content, good);
    if (!hold.carries(carried)) continue;
    const slot = storableFormAt(world, ctx, other.house, carried);
    if (slot === undefined || roomFor(world, ctx, other.house, slot) - hold.amount(carried) <= 0) continue;
    const bound = stockOf(world, other.house, slot) + hold.amount(carried);
    if (reachesCeiling(wantedThere, bound)) continue;
    if (markOf(stop, good) !== undefined) {
      // A balanced good weighs the two houses alone, settlement or not.
      if (spareOf(world, ctx, stop.house, good) - wantedThere.keep <= 0) continue;
      if (Math.floor((stockOf(world, stop.house, good) - bound) / 2) <= 0) continue;
      return { kind: 'load', good, from: stop.house };
    }
    const source = loadSourceOf(scope, good, wantedThere.keep);
    if (source !== undefined) return { kind: 'load', ...source };
  }
  return NEXT;
}

/** A house to load one unit of a good out of, and the form it holds the good in. */
interface LoadSource {
  readonly from: Entity;
  readonly good: number;
}

/**
 * Where the stop loads a unit of `good` while `keep` units stay at home: out of the stop's house while it
 * spares one, else, at a settlement stop, out of the settlement house nearest the cart that spares one
 * (ties by id), skipping houses the cart failed to reach. A settlement keeps `keep` summed over its
 * houses, and a house the cart already stands at goes first, so a unit dropped into the storehouse
 * meanwhile does not call the cart back from a settlement house it is still emptying. Undefined when
 * nothing may leave.
 */
function loadSourceOf(scope: LoadScope, good: number, keep: number): LoadSource | undefined {
  const { world, ctx, terrain, trader, cart, stop } = scope;
  const homeSpare = spareOf(world, ctx, stop.house, good);
  const homeForm = stockedFormAt(world, ctx, stop.house, good);
  const fromHome = homeForm === undefined ? undefined : { from: stop.house, good: homeForm };
  if (!stop.settlement) return homeSpare - keep >= 1 ? fromHome : undefined;
  const atHome = cartNearHouse(world, ctx, cart, stop.house);
  if (homeSpare - keep >= 1 && atHome) return fromHome;
  const members = settlementHouses(world, ctx, terrain, trader, stop.house, scope.exclude, good);
  const settlementSpare = new LendableTally(world, ctx);
  tallyStock(world, ctx, settlementSpare, stop.house, good);
  for (const house of members) tallyStock(world, ctx, settlementSpare, house, good);
  if (settlementSpare.total() - keep < 1) return undefined;
  if (homeSpare >= 1 && atHome) return fromHome;
  const anchor = vehicleAnchor(world, cart.vehicle);
  const failed = unreachableGoals(world, ctx, trader);
  let best: { readonly house: Entity; readonly distance: number } | undefined;
  for (const house of members) {
    if (spareOf(world, ctx, house, good) < 1) continue;
    const door = houseDoor(world, ctx, house);
    if (door === null || isUnreachableGoal(failed, doorGoal(terrain, door))) continue;
    const distance = anchor === null ? 0 : hexDistance(anchor, door);
    // Members run ascending by id, so a later house wins only when strictly nearer.
    if (best === undefined || distance < best.distance) best = { house, distance };
  }
  const form = best === undefined ? undefined : stockedFormAt(world, ctx, best.house, good);
  const fromMember = best === undefined || form === undefined ? undefined : { from: best.house, good: form };
  if (best !== undefined && best.distance <= TRADE_CART_HOUSE_DISTANCE) return fromMember;
  return homeSpare >= 1 ? fromHome : fromMember;
}

/** The units of `good` the stop holds at home: in its house, plus its settlement's houses at a
 *  settlement stop. */
function homeStockOf(scope: LoadScope, good: number): number {
  const { world, ctx, terrain, trader, stop } = scope;
  const held = (house: Entity, form: number | undefined): number =>
    form === undefined ? 0 : stockOf(world, house, form);
  let total = held(stop.house, storableFormAt(world, ctx, stop.house, good));
  if (!stop.settlement) return total;
  for (const house of settlementHouses(world, ctx, terrain, trader, stop.house, scope.exclude, good)) {
    total += held(house, stockedFormAt(world, ctx, house, good));
  }
  return total;
}

/** Whether `units` in (or bound for) a mark's stop reach the mark's `upTo` ceiling. */
function reachesCeiling(mark: DeepReadonly<TradeImportMark>, units: number): boolean {
  return mark.upTo !== TRADE_LIMIT_NONE && units >= mark.upTo;
}

function unloadInto(world: World, ctx: SystemContext, house: Entity, good: number): TradeAction {
  const slot = storableFormAt(world, ctx, house, good);
  const into = slot !== undefined && roomFor(world, ctx, house, slot) > 0 ? house : null;
  return { kind: 'unload', good, into };
}

/** The goods a house type counts as its own stock, ascending: what a trader may take out of it. */
function ownGoodsOf(ctx: ContentContext, buildingType: number): number[] {
  const stored = contentIndex(ctx.content).storedGoodsByBuilding.get(buildingType);
  if (stored === undefined) return [];
  return [...stored].filter((good) => countsAsOwnStock(ctx, buildingType, good)).sort((a, b) => a - b);
}

/** The units of `good` a house can give up: its own stock, none of it while its recipe consumes the
 *  good (the reserve it runs on), and no more than its owner's storage minimum lets go. Approximation of
 *  the original's per-house minimum stock setting. */
function spareOf(world: World, ctx: SystemContext, house: Entity, good: number): number {
  const stocked = fetchableFormAt(world, ctx, house, good);
  if (stocked === undefined) return 0;
  return Math.min(stockOf(world, house, stocked), storageLendable(world, ctx, house, stocked));
}

/** Adds a house's stock of `good` to a settlement's tally, which caps it by the owner's minimum once
 *  across the owner's storehouses rather than once per house as {@link spareOf} does. */
function tallyStock(
  world: World,
  ctx: SystemContext,
  tally: LendableTally,
  house: Entity,
  good: number,
): void {
  const stocked = fetchableFormAt(world, ctx, house, good);
  if (stocked !== undefined) tally.add(house, stocked, stockOf(world, house, stocked));
}

/** {@link stockedFormAt} when the house may give that form up at all. */
function fetchableFormAt(world: World, ctx: SystemContext, house: Entity, good: number): number | undefined {
  const stocked = stockedFormAt(world, ctx, house, good);
  return stocked !== undefined && mayFetchGoodFrom(world, ctx, house, stocked) ? stocked : undefined;
}

/** The good a house answers a request for `good` with out of its own stock: the good itself, else the
 *  first dish of its edible class the house makes (a bakery gives bread for `food_simple`). */
function stockedFormAt(world: World, ctx: ContentContext, house: Entity, good: number): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (countsAsOwnStock(ctx, type, good)) return good;
  const index = contentIndex(ctx.content);
  const stored = index.storedGoodsByBuilding.get(type);
  if (stored === undefined) return undefined;
  for (const candidate of [...stored].sort((a, b) => a - b)) {
    if (countsAsOwnStock(ctx, type, candidate) && sameFoodClass(ctx, candidate, good)) return candidate;
  }
  return undefined;
}

/** The slot a house takes `good` into, on any of its shelves, inputs included; undefined with none. */
function storableFormAt(world: World, ctx: ContentContext, house: Entity, good: number): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (typeStoresGood(ctx, type, good)) return good;
  const edible = edibleGoodFormOf(ctx.content, good);
  return edible !== good && typeStoresGood(ctx, type, edible) ? edible : undefined;
}
