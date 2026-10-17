import { HarvestedBy } from '../../../components/index.js';
import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';

const entityId = (e: Entity): number => e;

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
          else insertSortedById(marked, e, entityId);
        },
        withdraw: (e, harvester) => {
          const marked = this.byHarvester.get(harvester);
          if (marked === undefined) return;
          removeSortedById(marked, e, entityId);
          if (marked.length === 0) this.byHarvester.delete(harvester);
        },
        clear: () => this.byHarvester.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }

  verify(): string[] {
    this.catchUp();
    let marks = 0;
    const problems: string[] = [];
    for (const e of this.world.canonicalQuery(HarvestedBy)) {
      marks++;
      const by = this.world.get(e, HarvestedBy).by;
      if (this.byHarvester.get(by)?.includes(e) !== true)
        problems.push(`harvesterMarks lost the mark on ${e}`);
    }
    let held = 0;
    for (const marked of this.byHarvester.values()) held += marked.length;
    if (held !== marks) problems.push('harvesterMarks holds another number of marks than the store');
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
