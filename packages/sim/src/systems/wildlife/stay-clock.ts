import { WildHabitat } from '../../components/index.js';
import { includesSortedId, insertSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { HERD_ELIGIBILITY_STORES } from '../movement/herd-roster.js';

const idOf = (e: Entity): number => e;

/**
 * When each wild animal next decides what to do, derived from {@link WildHabitat.nextStayAt}: animals are
 * filed under the tick they come due, and one that comes due while walking or held waits until it stands
 * free again. A tick touches only the animals due on it and the waiting ones, never the whole wild
 * population. An animal that comes due while not herd-eligible is dropped, and filed again when a
 * store its eligibility reads changes. Filing reads only the stores and the tick, so a fresh clock after a
 * load files every animal exactly where the running one held it.
 */
class StayClock {
  private readonly due = new Map<number, Entity[]>();
  /** Animals past due that were not free to decide, ascending id. */
  private readonly waiting: Entity[] = [];
  private filedThrough: number | undefined;

  constructor(
    private readonly world: World,
    readonly feed: ChangeFeed,
  ) {}

  /** The animals to consider on `tick`, ascending id: those due now and those still waiting. */
  take(tick: number): Entity[] {
    if (this.filedThrough === undefined) {
      this.feed.drain(() => {});
      for (const e of this.world.canonicalQuery(WildHabitat)) this.file(e, tick);
    } else if (this.feed.drain((e) => this.file(e, tick))) {
      for (const e of this.world.canonicalQuery(WildHabitat)) this.file(e, tick);
    }
    const taken = [...this.waiting];
    for (let t = (this.filedThrough ?? tick - 1) + 1; t <= tick; t++) {
      for (const e of this.due.get(t) ?? [])
        if (!includesSortedId(taken, e, idOf)) insertSortedById(taken, e, idOf);
      this.due.delete(t);
    }
    this.filedThrough = tick;
    this.waiting.length = 0;
    return taken.filter((e) => {
      const at = this.world.tryGet(e, WildHabitat)?.nextStayAt;
      return at !== undefined && at <= tick;
    });
  }

  /** Keep `e` for the next tick: it came due but could not decide yet. */
  wait(e: Entity): void {
    if (!includesSortedId(this.waiting, e, idOf)) insertSortedById(this.waiting, e, idOf);
  }

  private file(e: Entity, tick: number): void {
    const at = this.world.tryGet(e, WildHabitat)?.nextStayAt;
    if (at === undefined) return;
    const slot = Math.max(at, this.filedThrough === undefined ? tick : this.filedThrough + 1, tick);
    const list = this.due.get(slot);
    if (list === undefined) this.due.set(slot, [e]);
    else if (list[list.length - 1] !== e) list.push(e);
  }
}

const clocks = new WeakMap<World, StayClock>();

/** `world`'s stay clock. */
export function stayClock(world: World): StayClock {
  let clock = clocks.get(world);
  if (clock === undefined) {
    clock = new StayClock(world, world.watchChanges(HERD_ELIGIBILITY_STORES, [WildHabitat]));
    clocks.set(world, clock);
  }
  return clock;
}
