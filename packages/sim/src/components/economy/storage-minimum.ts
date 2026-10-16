import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/** The highest minimum a player may set for one good; a command beyond it is clamped. */
export const STORAGE_MINIMUM_MAX = 999;

/**
 * A player's storage minimums: per good, the units its storehouses and headquarters keep between them.
 * Nobody takes a good out of them below its minimum, and a self-filling house's carrier brings its good
 * to storage first while the storehouses hold less. Our own rule, not the original's. One carrier entity
 * per player, created with the first minimum and destroyed when the last returns to zero. Read by key,
 * never iterated for a decision.
 */
export const StorageMinimums = defineComponent<{
  /** The player slot the minimums belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Good type -> minimum units, every value above zero. */
  minimums: Map<number, number>;
}>('StorageMinimums', 'players');

/** `player`'s minimum carrier, or null while it keeps no minimum. The lowest-id carrier wins should more
 *  than one ever exist. */
export function storageMinimumsEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(StorageMinimums)) {
    if (world.get(e, StorageMinimums).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** Player -> that player's minimums, rebuilt only after a carrier is added, removed or written. */
interface MinimumIndex {
  readonly membership: number;
  readonly values: number;
  readonly byPlayer: ReadonlyMap<number, ReadonlyMap<number, number>>;
}

const indexes = new WeakMap<World, MinimumIndex>();

function minimumIndex(world: World): MinimumIndex {
  const membership = world.componentGeneration(StorageMinimums);
  const values = world.componentValueGeneration(StorageMinimums);
  const cached = indexes.get(world);
  if (cached !== undefined && cached.membership === membership && cached.values === values) return cached;
  const byPlayer = new Map<number, ReadonlyMap<number, number>>();
  for (const e of world.canonicalQuery(StorageMinimums)) {
    const { player, minimums } = world.get(e, StorageMinimums);
    if (!byPlayer.has(player)) byPlayer.set(player, minimums);
  }
  const index = { membership, values, byPlayer };
  indexes.set(world, index);
  return index;
}

/** Whether any player keeps a minimum: the fast path that spares every caller the rule's cost while
 *  nobody uses it. Allocates nothing between carrier writes. */
export function anyStorageMinimum(world: World): boolean {
  return minimumIndex(world).byPlayer.size > 0;
}

/** The units of `goodType` `player`'s storehouses keep between them; zero without a minimum. */
export function storageMinimumOf(world: World, player: number | undefined, goodType: number): number {
  if (player === undefined) return 0;
  return minimumIndex(world).byPlayer.get(player)?.get(goodType) ?? 0;
}

/** Whether `player` keeps a minimum of any good. */
export function keepsStorageMinimums(world: World, player: number | undefined): boolean {
  return player !== undefined && minimumIndex(world).byPlayer.has(player);
}
