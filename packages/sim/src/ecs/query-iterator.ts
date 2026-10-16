import type { Component, Entity } from './component.js';
import { type ComponentStore, VACANT_SLOT } from './component-store.js';

/**
 * Walks the smallest required store, yielding the entities present in every other required store. Reusing
 * one {@link result} object (rather than a generator's fresh `{value, done}` per entity) is safe because the
 * for-of / spread protocol reads `.value` before the next `next()` call, so no stale id escapes the loop.
 * Like a `Map` iterator it sees members added during the walk and skips removed ones.
 */
export class QueryIterator implements IterableIterator<Entity> {
  private readonly result: IteratorResult<Entity> = { done: false, value: 0 as Entity };
  /** The required stores other than {@link walked}, probed per candidate. */
  private readonly others: Array<ComponentStore<unknown>> = [];
  private walked: ComponentStore<unknown> | null = null;
  private slot = 0;
  /** The walked store's {@link ComponentStore.epoch} that {@link slot} indexes into. */
  private epoch = 0;
  /** Insertion sequence of the last yielded slot, the resume point after a compaction. */
  private lastSeq = -1;

  constructor(
    storesById: ReadonlyArray<ComponentStore<unknown> | undefined>,
    required: ReadonlyArray<Component<unknown>>,
  ) {
    let smallest: ComponentStore<unknown> | undefined;
    for (const c of required) {
      const s = storesById[c.id];
      if (s === undefined) return;
      if (smallest === undefined || s.size < smallest.size) smallest = s;
    }
    if (smallest === undefined) return;
    for (const c of required) {
      const s = storesById[c.id];
      if (s !== undefined && s !== smallest) this.others.push(s);
    }
    this.walked = smallest;
    this.epoch = smallest.epoch;
  }

  next(): IteratorResult<Entity> {
    const store = this.walked;
    if (store === null) return this.finish();
    let slot = this.slot;
    if (store.epoch !== this.epoch) {
      slot = store.firstSlotAfter(this.lastSeq);
      this.epoch = store.epoch;
    }
    // Re-read per call: a store grows by reallocating its dense arrays.
    const entities = store.entities;
    const others = this.others;
    const end = store.length;
    while (slot < end) {
      const id = entities[slot++] ?? VACANT_SLOT;
      if (id === VACANT_SLOT) continue;
      let match = true;
      for (let i = 0; i < others.length; i++) {
        if (others[i]?.has(id as Entity) !== true) {
          match = false;
          break;
        }
      }
      if (match) {
        this.slot = slot;
        this.lastSeq = store.seqs[slot - 1] ?? 0;
        this.result.value = id as Entity;
        return this.result;
      }
    }
    return this.finish();
  }

  private finish(): IteratorResult<Entity> {
    this.walked = null;
    this.result.done = true;
    // The protocol ignores `value` once `done` is true, so the last yielded id is left in place.
    return this.result;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}
