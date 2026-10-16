import { Owner, ownerOf } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * An ascending-id candidate list split by side: each player's entities merged with the neutral ones, so a
 * scan skips every other player's. Keyed on the list's identity, so a source hands out a new array
 * whenever its members change; re-split as well when any {@link Owner} is added, removed or written.
 */
export class CandidateSides {
  private readonly byOwner = new Map<number, Entity[]>();
  private neutral: Entity[] = [];
  private split: readonly Entity[] | null = null;
  private ownerMembership = -1;
  private ownerValues = -1;

  constructor(private readonly world: World) {}

  /** The `candidates` {@link ownersCompatible} with `owner`, ascending id. */
  of(candidates: readonly Entity[], owner: number | undefined): readonly Entity[] {
    if (owner === undefined) return candidates;
    const membership = this.world.componentGeneration(Owner);
    const values = this.world.componentValueGeneration(Owner);
    if (membership !== this.ownerMembership || values !== this.ownerValues || candidates !== this.split) {
      this.resplit(candidates);
      this.ownerMembership = membership;
      this.ownerValues = values;
    }
    return this.byOwner.get(owner) ?? this.neutral;
  }

  private resplit(candidates: readonly Entity[]): void {
    this.byOwner.clear();
    this.neutral = [];
    this.split = candidates;
    for (const e of candidates) {
      const owner = ownerOf(this.world, e);
      if (owner === undefined) {
        this.neutral.push(e);
        for (const list of this.byOwner.values()) list.push(e);
        continue;
      }
      let list = this.byOwner.get(owner);
      if (list === undefined) {
        list = this.neutral.slice();
        this.byOwner.set(owner, list);
      }
      list.push(e);
    }
  }
}
