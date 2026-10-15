import {
  FarmAnimal,
  HerdMember,
  Livestock,
  Owner,
  Position,
  Settler,
  WildHabitat,
} from '../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';

/** Original behavior: a herd leader tends its range on the ticks where `(id + tick) % 60 == 0`. */
export const LEADER_UPKEEP_PERIOD_TICKS = 60;

/** The stores whose membership decides {@link herdEligible}. */
export const HERD_ELIGIBILITY_STORES = [
  HerdMember,
  Settler,
  Position,
  Owner,
  Livestock,
  FarmAnimal,
  WildHabitat,
];
const ROSTER_VALUES = [HerdMember, Owner];

const idOf = (e: Entity): number => e;
const NO_MEMBERS: readonly Entity[] = [];

/** Whether `e` is a free-roaming animal that keeps herd life: on the map, unclaimed, and either in a herd
 *  or carrying a wild range. A claimed animal answers to its farm or yard instead. */
export function herdEligible(world: World, e: Entity): boolean {
  if (!world.has(e, Settler) || !world.has(e, Position)) return false;
  if (world.has(e, FarmAnimal) || (world.has(e, Livestock) && world.has(e, Owner))) return false;
  return world.has(e, HerdMember) || world.has(e, WildHabitat);
}

/**
 * Who follows whom among the free-roaming animals, kept across ticks from the herd stores' changes: each
 * leader's members (itself included), the leaders bucketed by their upkeep slot in ascending id, and
 * the animals a change may have orphaned. A pass costs the changes since the last one, not the herds.
 */
class HerdRoster {
  /** The leader each eligible herd animal points at. */
  private readonly recorded = new Map<Entity, Entity>();
  private readonly members = new Map<Entity, Entity[]>();
  private readonly upkeepSlots: Entity[][] = Array.from({ length: LEADER_UPKEEP_PERIOD_TICKS }, () => []);
  /** Animals whose leader may have changed validity, ascending id. */
  private dirty: Entity[] = [];

  constructor(
    private readonly world: World,
    readonly feed: ChangeFeed,
  ) {
    this.rebuild();
  }

  update(): void {
    if (this.feed.drain((e) => this.resync(e))) this.rebuild();
  }

  /** The members of `leader`'s herd, itself included, ascending id. Shared: never mutate it. */
  membersOf(leader: Entity): readonly Entity[] {
    return this.members.get(leader) ?? NO_MEMBERS;
  }

  /** The leader eligible herd animal `e` points at, or undefined when it follows no one. */
  leaderOf(e: Entity): Entity | undefined {
    return this.recorded.get(e);
  }

  herdSize(leader: Entity): number {
    return this.membersOf(leader).length;
  }

  /** The leaders whose upkeep falls on `tick`, ascending id. */
  leadersDueAt(tick: number): readonly Entity[] {
    const slot =
      (LEADER_UPKEEP_PERIOD_TICKS - (tick % LEADER_UPKEEP_PERIOD_TICKS)) % LEADER_UPKEEP_PERIOD_TICKS;
    return this.upkeepSlots[slot] ?? NO_MEMBERS;
  }

  /** The animals to re-check for a valid leader, ascending id; the roster forgets them. */
  takeDirty(): Entity[] {
    const taken = this.dirty;
    this.dirty = [];
    return taken;
  }

  private rebuild(): void {
    this.feed.drain(() => {});
    this.recorded.clear();
    this.members.clear();
    for (const slot of this.upkeepSlots) slot.length = 0;
    this.dirty = [];
    for (const e of herdCandidates(this.world)) this.resync(e);
  }

  private resync(e: Entity): void {
    const world = this.world;
    const leader =
      world.isAlive(e) && herdEligible(world, e) ? world.tryGet(e, HerdMember)?.leader : undefined;
    const old = this.recorded.get(e);
    if (old !== leader) {
      if (old !== undefined) this.leave(e, old);
      if (leader !== undefined) this.join(e, leader);
    }
    // Its own leader may have gone, and when it led, so may its followers'.
    if (world.isAlive(e) && herdEligible(world, e)) this.markDirty(e);
    for (const m of this.membersOf(e)) if (m !== e) this.markDirty(m);
  }

  private join(e: Entity, leader: Entity): void {
    this.recorded.set(e, leader);
    let herd = this.members.get(leader);
    if (herd === undefined) {
      herd = [];
      this.members.set(leader, herd);
    }
    insertSortedById(herd, e, idOf);
    if (leader !== e) return;
    const slot = this.upkeepSlots[e % LEADER_UPKEEP_PERIOD_TICKS];
    if (slot !== undefined) insertSortedById(slot, e, idOf);
  }

  private leave(e: Entity, leader: Entity): void {
    this.recorded.delete(e);
    const herd = this.members.get(leader);
    if (herd !== undefined) {
      removeSortedById(herd, e, idOf);
      if (herd.length === 0) this.members.delete(leader);
    }
    if (leader !== e) return;
    const slot = this.upkeepSlots[e % LEADER_UPKEEP_PERIOD_TICKS];
    if (slot !== undefined) removeSortedById(slot, e, idOf);
  }

  private markDirty(e: Entity): void {
    if (!includesSortedId(this.dirty, e, idOf)) insertSortedById(this.dirty, e, idOf);
  }

  /** Compares the roster with a fresh scan of the herd stores. */
  verify(): string[] {
    this.update();
    const fresh = new Map<Entity, Entity>();
    for (const e of herdCandidates(this.world)) {
      const leader = herdEligible(this.world, e) ? this.world.tryGet(e, HerdMember)?.leader : undefined;
      if (leader !== undefined) fresh.set(e, leader);
    }
    let wrong = fresh.size === this.recorded.size ? 0 : 1;
    for (const [e, leader] of fresh) if (this.recorded.get(e) !== leader) wrong++;
    return wrong === 0 ? [] : [`herdRoster: ${wrong} records disagree with the herd stores`];
  }
}

/** Every animal in a herd or carrying a wild range, ascending id. */
export function herdCandidates(world: World): Entity[] {
  const ids = new Set<Entity>([...world.canonicalQuery(HerdMember), ...world.canonicalQuery(WildHabitat)]);
  return [...ids].sort((a, b) => a - b);
}

const rosters = new WeakMap<World, HerdRoster>();

/** `world`'s herd roster, brought up to date. Valid until the next store change; never mutate it. */
export function herdRoster(world: World): HerdRoster {
  const held = rosters.get(world);
  if (held !== undefined) {
    held.update();
    return held;
  }
  const roster = new HerdRoster(world, world.watchChanges(HERD_ELIGIBILITY_STORES, ROSTER_VALUES));
  world.registerCacheVerifier('herdRoster', () => rosters.get(world)?.verify() ?? []);
  rosters.set(world, roster);
  return roster;
}

export type { HerdRoster };
