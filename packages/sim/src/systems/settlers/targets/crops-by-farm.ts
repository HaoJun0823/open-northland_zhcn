import { Crop, Position } from '../../../components/index.js';
import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';

const entityId = (e: Entity): number => e;

/**
 * The positioned sown fields grouped by the farm that sowed them, each group ascending-id, kept across
 * ticks per world from the `Crop` and `Position` journals, so a pass pays for the fields sown, watered or
 * reaped since the last one. A farm with no field left has no group. Derived read state, never hashed.
 */
class FarmFields {
  readonly byFarm = new Map<Entity, Entity[]>();
  private readonly captures: JournaledCaptures<Entity>;

  constructor(private readonly world: World) {
    this.captures = new JournaledCaptures<Entity>(
      world,
      { membership: [Crop, Position], values: [Crop] },
      () => world.canonicalQuery(Crop, Position),
      {
        capture: (e) => farmOf(world, e),
        apply: (e, farm) => {
          const fields = this.byFarm.get(farm);
          if (fields === undefined) this.byFarm.set(farm, [e]);
          else insertSortedById(fields, e, entityId);
        },
        withdraw: (e, farm) => {
          const fields = this.byFarm.get(farm);
          if (fields === undefined) return;
          removeSortedById(fields, e, entityId);
          if (fields.length === 0) this.byFarm.delete(farm);
        },
        clear: () => this.byFarm.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }

  verify(): string[] {
    this.catchUp();
    const fresh = new Map<Entity, Entity[]>();
    for (const e of this.world.canonicalQuery(Crop, Position)) {
      const farm = farmOf(this.world, e);
      if (farm === null) continue;
      const fields = fresh.get(farm);
      if (fields === undefined) fresh.set(farm, [e]);
      else fields.push(e);
    }
    const problems: string[] = [];
    if (fresh.size !== this.byFarm.size) problems.push('cropsByFarm holds another set of farms');
    for (const [farm, fields] of fresh) {
      const held = this.byFarm.get(farm);
      if (held === undefined || held.length !== fields.length || held.some((e, i) => fields[i] !== e)) {
        problems.push(`cropsByFarm fields of farm ${farm} diverge from a fresh scan`);
      }
    }
    return problems;
  }
}

function farmOf(world: World, e: Entity): Entity | null {
  return world.has(e, Position) ? (world.tryGet(e, Crop)?.farm ?? null) : null;
}

const held = new WeakMap<World, FarmFields>();

/** `world`'s sown fields by farm, caught up to the fields standing now; live, valid until the next call. */
export function cropsByFarm(world: World): ReadonlyMap<Entity, readonly Entity[]> {
  let fields = held.get(world);
  if (fields === undefined) {
    const created = new FarmFields(world);
    world.registerCacheVerifier('cropsByFarm', () => created.verify());
    held.set(world, created);
    fields = created;
  } else {
    fields.catchUp();
  }
  return fields.byFarm;
}
