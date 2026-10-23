import { EquipOrder, Owner, ownerOf, Settler } from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { EQUIP_FETCH_UNITS } from '../atomics/effects/goods/index.js';

/** One errand's hold: `EQUIP_FETCH_UNITS` of `goodType` against `owner`'s pool. */
interface FetchHold {
  readonly owner: number;
  readonly goodType: number;
}

/** The holds kept from the order, job and owner changes, so a read costs the errands that changed. */
interface FetchTally {
  readonly feed: ChangeFeed;
  readonly holds: Map<Entity, FetchHold>;
  readonly byOwner: Map<number, Map<number, number>>;
}

const tallies = new WeakMap<World, FetchTally>();

/** The hold `e`'s errand places now, or null. */
function holdOf(world: World, e: Entity): FetchHold | null {
  const order = world.tryGet(e, EquipOrder);
  if (order === undefined || order.stage !== 'acquire' || order.goodType === null) return null;
  if (world.tryGet(e, Settler)?.jobType == null) return null;
  const owner = ownerOf(world, e);
  return owner === undefined ? null : { owner, goodType: order.goodType };
}

function count(byOwner: Map<number, Map<number, number>>, hold: FetchHold, units: number): void {
  let held = byOwner.get(hold.owner);
  if (held === undefined) {
    held = new Map();
    byOwner.set(hold.owner, held);
  }
  const total = (held.get(hold.goodType) ?? 0) + units;
  if (total === 0) held.delete(hold.goodType);
  else held.set(hold.goodType, total);
}

function resync(world: World, tally: FetchTally, e: Entity): void {
  const before = tally.holds.get(e);
  const after = holdOf(world, e);
  if (before?.owner === after?.owner && before?.goodType === after?.goodType) return;
  if (before !== undefined) {
    count(tally.byOwner, before, -EQUIP_FETCH_UNITS);
    tally.holds.delete(e);
  }
  if (after !== null) {
    count(tally.byOwner, after, EQUIP_FETCH_UNITS);
    tally.holds.set(e, after);
  }
}

function rescan(world: World, tally: FetchTally): void {
  tally.holds.clear();
  tally.byOwner.clear();
  for (const e of world.query(EquipOrder)) resync(world, tally, e);
}

/** Fresh holds from the stores, for the cache verifier. */
function scanned(world: World): Map<number, Map<number, number>> {
  const byOwner = new Map<number, Map<number, number>>();
  for (const e of world.query(EquipOrder)) {
    const hold = holdOf(world, e);
    if (hold !== null) count(byOwner, hold, EQUIP_FETCH_UNITS);
  }
  return byOwner;
}

function sameTotals(a: Map<number, Map<number, number>>, b: Map<number, Map<number, number>>): boolean {
  const owners = new Set([...a.keys(), ...b.keys()]);
  for (const owner of owners) {
    const held = a.get(owner);
    const fresh = b.get(owner);
    if ((held?.size ?? 0) !== (fresh?.size ?? 0)) return false;
    for (const [good, units] of held ?? []) if (fresh?.get(good) !== units) return false;
  }
  return true;
}

function tallyOf(world: World): FetchTally {
  let tally = tallies.get(world);
  if (tally === undefined) {
    const watched = [EquipOrder, Settler, Owner];
    tally = { feed: world.watchChanges(watched, watched), holds: new Map(), byOwner: new Map() };
    tallies.set(world, tally);
    rescan(world, tally);
    world.registerCacheVerifier('equipFetchesHeld', () => {
      const held = tallies.get(world);
      if (held === undefined) return [];
      if (held.feed.pending) catchUp(world, held);
      return sameTotals(held.byOwner, scanned(world))
        ? []
        : ['equipFetchesHeld: held totals disagree with a scan of the equip orders'];
    });
  } else if (tally.feed.pending) catchUp(world, tally);
  return tally;
}

function catchUp(world: World, tally: FetchTally): void {
  if (tally.feed.drain((e) => resync(world, tally, e))) rescan(world, tally);
}

/**
 * The units of each good, per owning player, held by equip errands underway: an errand in its `acquire`
 * stage holds one unit of its good from dispatch until the pickup. Every automatic dispatcher subtracts
 * these from the stock it hands out, so a man sent for a unit takes it out of the pool and no second man is
 * sent after it. A jobless settler's errand is frozen, since the ladder never plans one, so it holds
 * nothing. The live totals, which the next read brings up to date, so a caller stamping errands keeps its
 * own count of them until it is done reading.
 */
export function equipFetchesHeld(world: World): ReadonlyMap<number, ReadonlyMap<number, number>> {
  return tallyOf(world).byOwner;
}
