import { HarvestedBy } from '../../../components/index.js';
import { insertSortedById, ownId, removeSortedById } from '../../../core/sorted-id.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';

/**
 * The entities carrying a {@link HarvestedBy} mark, grouped by the harvester it names, each group
 * ascending-id, kept across ticks per world from the mark's journals, so a pass pays for the marks set or
 * lifted since the last one. Derived read state, never hashed.
 */
class HarvesterMarks {
  readonly byHarvester = new Map<Entity, Entity[]>();
  private readonly captures: JournaledCaptures<Entity>;

  constructor(private readonly world: World) {
    this.captures = new JournaledCaptures<Entity>(
      world,
      { membership: [HarvestedBy], values: [HarvestedBy] },
      () => world.canonicalQuery(HarvestedBy),
      {
        capture: (e) => world.tryGet(e, HarvestedBy)?.by ?? null,
        apply: (e, harvester) => {
          const marked = this.byHarvester.get(harvester);
          if (marked === undefined) this.byHarvester.set(harvester, [e]);
          else insertSortedById(marked, e, ownId);
        },
        withdraw: (e, harvester) => {
          const marked = this.byHarvester.get(harvester);
          if (marked === undefined) return;
          removeSortedById(marked, e, ownId);
          if (marked.length === 0) this.byHarvester.delete(harvester);
        },
        clear: () => this.byHarvester.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }

  /** Compares every group, order included, with a fresh grouping of the ascending marks. */
  verify(): string[] {
    this.catchUp();
    const fresh = new Map<Entity, Entity[]>();
    for (const e of this.world.canonicalQuery(HarvestedBy)) {
      const by = this.world.get(e, HarvestedBy).by;
      const marked = fresh.get(by);
      if (marked === undefined) fresh.set(by, [e]);
      else marked.push(e);
    }
    const problems: string[] = [];
    if (fresh.size !== this.byHarvester.size)
      problems.push(
        `harvesterMarks holds ${this.byHarvester.size} harvesters but the store has ${fresh.size}`,
      );
    for (const [by, marked] of fresh) {
      const held = this.byHarvester.get(by);
      if (held?.length !== marked.length || !held.every((e, i) => e === marked[i]))
        problems.push(`harvesterMarks holds a stale group for harvester ${by}`);
    }
    return problems;
  }
}

const held = new WeakMap<World, HarvesterMarks>();

/** `world`'s marked entities by harvester, caught up to the marks standing now; live, valid until the next
 *  call. */
export function harvesterMarks(world: World): ReadonlyMap<Entity, readonly Entity[]> {
  let marks = held.get(world);
  if (marks === undefined) {
    const created = new HarvesterMarks(world);
    world.registerCacheVerifier('harvesterMarks', () => created.verify());
    held.set(world, created);
    marks = created;
  } else {
    marks.catchUp();
  }
  return marks.byHarvester;
}
