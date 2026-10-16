import { WildHabitat } from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { HERD_ELIGIBILITY_STORES } from '../movement/herd-roster.js';

/** Entity slots each take buffer starts with; it doubles when an entry would not fit. */
const INITIAL_BUFFER_CAPACITY = 256;

function grown(buffer: Int32Array, needed: number): Int32Array {
  let capacity = buffer.length * 2;
  while (capacity < needed) capacity *= 2;
  const next = new Int32Array(capacity);
  next.set(buffer);
  return next;
}

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
  /** Animals past due that were not free to decide, its first {@link waitingCount} slots, in any order and
   *  possibly repeated. Swapped with {@link taken} on every take, so neither is reallocated per tick. */
  private waiting: Int32Array = new Int32Array(INITIAL_BUFFER_CAPACITY);
  private waitingCount = 0;
  /** The last take's backing store; the caller reads its view while {@link wait} fills the other one. */
  private taken: Int32Array = new Int32Array(INITIAL_BUFFER_CAPACITY);
  private filedThrough: number | undefined;

  constructor(
    private readonly world: World,
    readonly feed: ChangeFeed,
  ) {}

  /** The animals to consider on `tick`, ascending id: those due now and those still waiting. The view is
   *  valid until the next take. */
  take(tick: number): Int32Array {
    if (this.filedThrough === undefined) {
      this.feed.drain(() => {});
      for (const e of this.world.canonicalQuery(WildHabitat)) this.file(e, tick);
    } else if (this.feed.drain((e) => this.file(e, tick))) {
      for (const e of this.world.canonicalQuery(WildHabitat)) this.file(e, tick);
    }
    let buffer = this.waiting;
    let count = this.waitingCount;
    for (let t = (this.filedThrough ?? tick - 1) + 1; t <= tick; t++) {
      const list = this.due.get(t);
      if (list === undefined) continue;
      if (count + list.length > buffer.length) buffer = grown(buffer, count + list.length);
      for (const e of list) buffer[count++] = e;
      this.due.delete(t);
    }
    this.filedThrough = tick;
    buffer.subarray(0, count).sort();
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const e = buffer[i] as Entity;
      if (kept > 0 && buffer[kept - 1] === e) continue;
      const at = this.world.tryGet(e, WildHabitat)?.nextStayAt;
      if (at !== undefined && at <= tick) buffer[kept++] = e;
    }
    this.waiting = this.taken;
    this.waitingCount = 0;
    this.taken = buffer;
    return buffer.subarray(0, kept);
  }

  /** Keep `e` for the next tick: it came due but could not decide yet. */
  wait(e: Entity): void {
    if (this.waitingCount === this.waiting.length) this.waiting = grown(this.waiting, this.waitingCount + 1);
    this.waiting[this.waitingCount++] = e;
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
