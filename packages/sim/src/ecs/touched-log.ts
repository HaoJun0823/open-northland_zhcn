import type { Component, Entity } from './component.js';

/** Log size past which the whole log is dropped rather than grown forever. Only reachable when nothing
 *  drains it (a snapshot-less headless benchmark); one full cache rebuild is the entire cost. */
export const TOUCHED_LOG_OVERFLOW_LIMIT = 65536;

/** Entity ids below this are marked in a dense array; a higher id (only a crafted save can name one)
 *  falls back to a map, so a hostile id cannot size the array. */
const DENSE_MARK_LIMIT = 1 << 24;
const INITIAL_CAPACITY = 1024;
/** A dense entity's epoch and slot sit side by side, so logging a write reads one cache line. */
const MARK_STRIDE = 2;
const MARK_SLOT = 1;

/**
 * The entities whose components changed since the last {@link drain}: the invalidation feed for
 * identity-keyed read caches (the snapshot's per-entity clone cache). Read-path only, never consulted by a
 * sim decision, so it cannot affect determinism. Entities are logged in record order and marked with the
 * current epoch and their slot in that order, so a drain starts a new epoch instead of clearing a set.
 */
export class TouchedLog {
  private order = new Int32Array(INITIAL_CAPACITY);
  private count = 0;
  /** Per dense entity, the epoch it was last logged in and its index in `order` then. */
  private marks = new Int32Array(INITIAL_CAPACITY * MARK_STRIDE);
  /** Per sparse entity, its index in `order`; cleared with each epoch. */
  private readonly sparseSlots = new Map<Entity, number>();
  /** Per slot, whether its entity's membership changed this epoch. */
  private memberships = new Uint8Array(INITIAL_CAPACITY);
  private epoch = 1;
  /** Per slot, the components its entity wrote this epoch, in first-write order: the first
   *  `writtenCounts[slot]` entries. A list keeps its storage across epochs, so a newly logged entity
   *  reuses its slot's list without allocating. */
  private readonly written: Component<unknown>[][] = [];
  private writtenCounts = new Int32Array(INITIAL_CAPACITY);
  private detailed = false;
  private mutations = 0;
  private overflowed = false;

  /** Monotonic count of every recorded mutation. Unlike "is the log empty" it cannot be falsified by one
   *  consumer draining the log between another consumer's two staleness probes. */
  get mutationCount(): number {
    return this.mutations;
  }

  /** Start collecting component details before the first snapshot cache is populated. */
  trackComponents(): void {
    this.detailed = true;
  }

  /** Record an entity mutation and return its unique monotonic revision. `membership` marks a write
   *  that added or removed the component rather than changing its value. */
  record(entity: Entity, component?: Component<unknown>, membership = false): number {
    this.mutations++;
    if (this.count >= TOUCHED_LOG_OVERFLOW_LIMIT) {
      this.forget();
      this.overflowed = true;
    }
    let slot = this.slotOf(entity);
    if (slot < 0) {
      slot = this.count++;
      if (slot === this.order.length) {
        this.order = grown(this.order, slot + 1);
        this.writtenCounts = grown(this.writtenCounts, slot + 1);
        const memberships = new Uint8Array(this.order.length);
        memberships.set(this.memberships);
        this.memberships = memberships;
      }
      this.order[slot] = entity;
      this.writtenCounts[slot] = 0;
      this.memberships[slot] = 0;
      this.mark(entity, slot);
    }
    if (!this.detailed) return this.mutations;
    if (component !== undefined) this.addWritten(slot, component);
    if (membership) this.memberships[slot] = 1;
    return this.mutations;
  }

  /** Whether `entity` has a recorded mutation the next {@link drain} will deliver. After an overflow every
   *  entity counts as pending, since the individual names were lost. */
  pending(entity: Entity): boolean {
    return this.overflowed || this.slotOf(entity) >= 0;
  }

  /**
   * Hands every logged entity to `consume` and clears the log. Returns `true` when the log overflowed since
   * the last drain: those individual evictions were lost, so the consumer must discard its entire cache.
   * A component list is lent for the callback only, and only its first `count` entries are the entity's;
   * the log reuses the list afterward.
   */
  drain(
    consume: (
      entity: Entity,
      components: readonly Component<unknown>[],
      count: number,
      membership: boolean,
    ) => void,
  ): boolean {
    const written = this.written;
    for (let slot = 0; slot < this.count; slot++) {
      const e = this.order[slot] as Entity;
      const components = written[slot];
      const membership = this.memberships[slot] === 1;
      if (components === undefined) consume(e, NO_COMPONENTS, 0, membership);
      else consume(e, components, this.writtenCounts[slot] as number, membership);
    }
    this.count = 0;
    this.forget();
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }

  /** Empty the log: a new epoch voids every mark at once. */
  private forget(): void {
    this.count = 0;
    this.epoch++;
    this.sparseSlots.clear();
  }

  /** Add `component` to the slot's list unless it holds it, writing over a previous epoch's entries
   *  rather than growing the list. */
  private addWritten(slot: number, component: Component<unknown>): void {
    const written = this.listAt(slot);
    const count = this.writtenCounts[slot] as number;
    for (let i = 0; i < count; i++) if (written[i] === component) return;
    if (count < written.length) written[count] = component;
    else written.push(component);
    this.writtenCounts[slot] = count + 1;
  }

  /** The slot's component list; component tracking that began mid-epoch finds none for earlier slots. */
  private listAt(slot: number): Component<unknown>[] {
    const written = this.written;
    while (written.length <= slot) written.push([]);
    return written[slot] as Component<unknown>[];
  }

  /** The entity's slot in this epoch, or -1 when it is not logged. */
  private slotOf(entity: Entity): number {
    if (entity >= DENSE_MARK_LIMIT) return this.sparseSlots.get(entity) ?? -1;
    const at = entity * MARK_STRIDE;
    return at < this.marks.length && this.marks[at] === this.epoch
      ? (this.marks[at + MARK_SLOT] as number)
      : -1;
  }

  private mark(entity: Entity, slot: number): void {
    if (entity >= DENSE_MARK_LIMIT) {
      this.sparseSlots.set(entity, slot);
      return;
    }
    const at = entity * MARK_STRIDE;
    if (at >= this.marks.length) this.marks = grown(this.marks, at + MARK_STRIDE);
    this.marks[at] = this.epoch;
    this.marks[at + MARK_SLOT] = slot;
  }
}

/** `buffer` copied into one at least `needed` long, doubling so growth stays amortized. */
function grown(buffer: Int32Array<ArrayBuffer>, needed: number): Int32Array<ArrayBuffer> {
  let length = buffer.length * 2;
  while (length < needed) length *= 2;
  const next = new Int32Array(length);
  next.set(buffer);
  return next;
}

const NO_COMPONENTS: readonly Component<unknown>[] = [];
