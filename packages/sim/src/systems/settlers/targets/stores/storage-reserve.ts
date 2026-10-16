import { anyStorageMinimum, Building, ownerOf, storageMinimumOf } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { ContentContext } from '../../../context.js';
import { isStorehouseType, type SupplyTally } from '../../../stores/index.js';
import { FetchableStock } from './fetchable-stock.js';

/** The player whose storage minimum binds `store`'s `goodType`: its owner when `store` is a storehouse and
 *  the owner keeps a minimum of the good, else undefined. */
export function minimumBoundOwner(
  world: World,
  ctx: ContentContext,
  store: Entity,
  goodType: number,
): number | undefined {
  if (!anyStorageMinimum(world)) return undefined;
  const building = world.tryGet(store, Building);
  if (building === undefined || !isStorehouseType(ctx.content, building.buildingType)) return undefined;
  const owner = ownerOf(world, store);
  return storageMinimumOf(world, owner, goodType) > 0 ? owner : undefined;
}

/** What `player`'s storehouses hold of `goodType` above its minimum between them. With `supply`, the units
 *  walkers already claimed out of those storehouses are spent too, so a fetch is planned only against
 *  stock nobody else is walking to. */
export function storageSurplus(
  world: World,
  ctx: ContentContext,
  player: number,
  goodType: number,
  supply?: SupplyTally,
): number {
  const ledger = FetchableStock.of(world, ctx);
  let claimed = 0;
  if (supply !== undefined) {
    for (const storage of ledger.storagesOf(player)) claimed += supply.reservedAt(storage, goodType);
  }
  return Math.max(
    0,
    ledger.storedUnits(player, goodType) - storageMinimumOf(world, player, goodType) - claimed,
  );
}

/** The units of `goodType` `store` may give up under its owner's storage minimum: unbounded unless the
 *  minimum binds it ({@link minimumBoundOwner}), else the owner's {@link storageSurplus}. */
export function storageLendable(
  world: World,
  ctx: ContentContext,
  store: Entity,
  goodType: number,
  supply?: SupplyTally,
): number {
  const owner = minimumBoundOwner(world, ctx, store, goodType);
  return owner === undefined ? Infinity : storageSurplus(world, ctx, owner, goodType, supply);
}

/** At most `want` units of `goodType`, as many as `store` may give up under its owner's minimum. Every
 *  taking effect caps its lift here, since a claim only steers the choice and never the pickup. */
export function cappedByStorageMinimum(
  world: World,
  ctx: ContentContext,
  store: Entity,
  goodType: number,
  want: number,
): number {
  return Math.min(want, storageLendable(world, ctx, store, goodType));
}

/** Whether `player`'s storehouses hold less of `goodType` than its minimum. */
export function storageBelowMinimum(
  world: World,
  ctx: ContentContext,
  player: number,
  goodType: number,
): boolean {
  const minimum = storageMinimumOf(world, player, goodType);
  return minimum > 0 && FetchableStock.of(world, ctx).storedUnits(player, goodType) < minimum;
}

/** Adds up what several stores may give up. A store bound by its owner's minimum counts its stock toward
 *  that owner, and the owner's storehouses together give up no more than its {@link storageSurplus}: a
 *  per-store cap summed over stores would count the one surplus once per storehouse. */
export class LendableTally {
  private free = 0;
  /** Owner -> good type -> units its bound storehouses hold. */
  private readonly bound = new Map<number, Map<number, number>>();

  constructor(
    private readonly world: World,
    private readonly ctx: ContentContext,
  ) {}

  add(store: Entity, goodType: number, units: number): void {
    const owner = minimumBoundOwner(this.world, this.ctx, store, goodType);
    if (owner === undefined) {
      this.free += units;
      return;
    }
    let goods = this.bound.get(owner);
    if (goods === undefined) {
      goods = new Map();
      this.bound.set(owner, goods);
    }
    goods.set(goodType, (goods.get(goodType) ?? 0) + units);
  }

  total(): number {
    let total = this.free;
    for (const [owner, goods] of this.bound) {
      for (const [goodType, units] of goods) {
        total += Math.min(units, storageSurplus(this.world, this.ctx, owner, goodType));
      }
    }
    return total;
  }
}
