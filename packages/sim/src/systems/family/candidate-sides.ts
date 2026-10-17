import { ownerOf, ownersCompatible } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';

const byId = (e: Entity): number => e;

/**
 * An ascending-id candidate list kept split by side as members join and leave: each player's entities
 * merged with the neutral ones, so a scan skips every other player's. The owner is the one the caller
 * captured when the member joined; a member whose owner changes leaves and joins again.
 */
export class SidedCandidates {
  private readonly members: Entity[] = [];
  private readonly neutral: Entity[] = [];
  private readonly byOwner = new Map<number, Entity[]>();

  /** Every member, ascending id: live, so read it within one query and never write it. */
  get all(): readonly Entity[] {
    return this.members;
  }

  /** The members `ownersCompatible` with `owner`, ascending id; live like {@link all}. */
  of(owner: number | undefined): readonly Entity[] {
    if (owner === undefined) return this.members;
    return this.byOwner.get(owner) ?? this.neutral;
  }

  insert(e: Entity, owner: number | undefined): void {
    insertSortedById(this.members, e, byId);
    if (owner === undefined) {
      insertSortedById(this.neutral, e, byId);
      for (const list of this.byOwner.values()) insertSortedById(list, e, byId);
      return;
    }
    let list = this.byOwner.get(owner);
    if (list === undefined) {
      list = this.neutral.slice();
      this.byOwner.set(owner, list);
    }
    insertSortedById(list, e, byId);
  }

  remove(e: Entity, owner: number | undefined): void {
    removeSortedById(this.members, e, byId);
    if (owner === undefined) {
      removeSortedById(this.neutral, e, byId);
      for (const list of this.byOwner.values()) removeSortedById(list, e, byId);
      return;
    }
    const list = this.byOwner.get(owner);
    if (list !== undefined) removeSortedById(list, e, byId);
  }

  clear(): void {
    this.members.length = 0;
    this.neutral.length = 0;
    this.byOwner.clear();
  }
}

/** Whether every side `sides` holds lists exactly the `fresh` members compatible with its owner, for a
 *  cache verifier. */
export function sidesMatch(world: World, fresh: readonly Entity[], sides: SidedCandidates): boolean {
  const owners = new Set<number | undefined>([undefined]);
  for (const e of fresh) owners.add(ownerOf(world, e));
  for (const owner of owners) {
    const want = fresh.filter((e) => ownersCompatible(owner, ownerOf(world, e)));
    const held = sides.of(owner);
    if (want.length !== held.length || want.some((e, i) => e !== held[i])) return false;
  }
  return true;
}
