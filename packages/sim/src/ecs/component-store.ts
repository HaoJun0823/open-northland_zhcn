import type { Entity } from './component.js';

/** Entity ids per index page. A page takes an index block only while it holds a member, so a component
 *  whose members sit in a few id ranges stays small; an emptied block is reused by the next new page. */
const PAGE_BITS = 8;
export const PAGE_SIZE = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_SIZE - 1;
/** Entity ids start at 1, so 0 marks a vacated dense slot; an index entry holds `slot + 1`. */
export const VACANT_SLOT = 0;
/** A page table entry holds `block + 1`; this marks a page without a block. */
const NO_BLOCK = 0;
const MIN_ENTITY = 1;
/** The largest id an `Int32Array` dense slot holds. */
const MAX_ENTITY = 0x7fffffff;
const INITIAL_CAPACITY = 8;
/** Vacated slots are compacted away once they exceed this share of the dense length... */
const VACANCY_COMPACT_FRACTION = 0.25;
/** ...and this count, so a small store churning one member does not rebuild on every removal. */
const VACANCY_COMPACT_MIN = 64;
/** After a compaction the dense arrays shrink to the live length once they are this many times larger. */
const SHRINK_FACTOR = 4;

/**
 * One component's entity-to-value store: a paged entity-to-slot index over dense arrays kept in insertion
 * order. The index blocks share one buffer behind a page table, so a lookup reads two typed arrays the
 * store owns rather than a typed array object per page. Iteration visits slots in insertion order, like a
 * `Map`: a removal vacates its slot and a re-add appends at the end. Compaction preserves the order and
 * bumps {@link epoch}; every slot carries an ascending insertion sequence so an open cursor can find its
 * place again ({@link firstSlotAfter}).
 */
export class ComponentStore<T> {
  /** Page number to `block + 1`, {@link NO_BLOCK} while the page holds no member. */
  private pageTable = new Int32Array(0);
  /** {@link PAGE_SIZE} entries per block, each `slot + 1` or {@link VACANT_SLOT}. */
  private index = new Int32Array(0);
  private blockMembers = new Int32Array(0);
  private blockCount = 0;
  /** Emptied, all-zero blocks, reused before the index grows. */
  private readonly freeBlocks: number[] = [];
  private denseEntities = new Int32Array(INITIAL_CAPACITY);
  private denseSeqs = new Float64Array(INITIAL_CAPACITY);
  private values: Array<T | undefined> = [];
  private revisions = new Float64Array(INITIAL_CAPACITY);
  private denseLength = 0;
  private liveSize = 0;
  private compactions = 0;
  private nextSeq = 0;

  /** Dense members in insertion order; {@link VACANT_SLOT} marks a vacated slot. Callers only read it. */
  get entities(): Int32Array {
    return this.denseEntities;
  }

  /** Insertion sequence per dense slot, ascending across the dense range. Callers only read it. */
  get seqs(): Float64Array {
    return this.denseSeqs;
  }

  /** Dense slots in use, vacated ones included. */
  get length(): number {
    return this.denseLength;
  }

  /** Live members. */
  get size(): number {
    return this.liveSize;
  }

  /** Bumped by every compaction, which moves slots under an open cursor. */
  get epoch(): number {
    return this.compactions;
  }

  /** The dense slot of `entity`, or -1 while it is not a member. */
  slotOf(entity: Entity): number {
    const page = entity >>> PAGE_BITS;
    const table = this.pageTable;
    if (page >= table.length) return -1;
    const block = table[page] as number;
    if (block === NO_BLOCK) return -1;
    return (this.index[((block - 1) << PAGE_BITS) | (entity & PAGE_MASK)] as number) - 1;
  }

  has(entity: Entity): boolean {
    const page = entity >>> PAGE_BITS;
    const table = this.pageTable;
    if (page >= table.length) return false;
    const block = table[page] as number;
    return (
      block !== NO_BLOCK && this.index[((block - 1) << PAGE_BITS) | (entity & PAGE_MASK)] !== VACANT_SLOT
    );
  }

  get(entity: Entity): T | undefined {
    const slot = this.slotOf(entity);
    return slot < 0 ? undefined : this.values[slot];
  }

  valueAt(slot: number): T | undefined {
    return this.values[slot];
  }

  revisionAt(slot: number): number {
    return this.revisions[slot] ?? 0;
  }

  /** Records the revision of a member's value; a non-member is ignored. */
  setRevision(entity: Entity, revision: number): void {
    const slot = this.slotOf(entity);
    if (slot >= 0) this.revisions[slot] = revision;
  }

  setRevisionAt(slot: number, revision: number): void {
    this.revisions[slot] = revision;
  }

  /** Stores `value` for `entity`, keeping a member's slot and appending a newcomer; true when it entered. */
  set(entity: Entity, value: T): boolean {
    if (entity < MIN_ENTITY || entity > MAX_ENTITY) {
      throw new RangeError(`ComponentStore.set: entity ${entity} is outside ${MIN_ENTITY}..${MAX_ENTITY}`);
    }
    const at = this.indexEntryOrAllocate(entity);
    const existing = (this.index[at] as number) - 1;
    if (existing >= 0) {
      this.values[existing] = value;
      return false;
    }
    if (this.denseLength === this.denseEntities.length) this.resize(this.denseLength * 2);
    const slot = this.denseLength++;
    this.denseEntities[slot] = entity;
    this.denseSeqs[slot] = this.nextSeq++;
    this.revisions[slot] = 0;
    this.values[slot] = value;
    this.index[at] = slot + 1;
    const block = at >>> PAGE_BITS;
    this.blockMembers[block] = (this.blockMembers[block] as number) + 1;
    this.liveSize++;
    return true;
  }

  /** Removes `entity`, vacating its slot; true when it was a member. */
  delete(entity: Entity): boolean {
    const page = entity >>> PAGE_BITS;
    if (page >= this.pageTable.length) return false;
    const block = (this.pageTable[page] as number) - 1;
    if (block < 0) return false;
    const at = (block << PAGE_BITS) | (entity & PAGE_MASK);
    const slot = (this.index[at] as number) - 1;
    if (slot < 0) return false;
    this.index[at] = VACANT_SLOT;
    const left = (this.blockMembers[block] as number) - 1;
    this.blockMembers[block] = left;
    if (left === 0) {
      this.pageTable[page] = NO_BLOCK;
      this.freeBlocks.push(block);
    }
    this.denseEntities[slot] = VACANT_SLOT;
    this.values[slot] = undefined;
    this.liveSize--;
    const vacant = this.denseLength - this.liveSize;
    if (vacant >= VACANCY_COMPACT_MIN && vacant > this.denseLength * VACANCY_COMPACT_FRACTION) this.compact();
    return true;
  }

  /** The first dense slot whose insertion sequence exceeds `seq`: where a cursor that last visited `seq`
   *  resumes after a compaction. */
  firstSlotAfter(seq: number): number {
    let lo = 0;
    let hi = this.denseLength;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.denseSeqs[mid] ?? 0) > seq) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Members in insertion order. */
  keys(): Entity[] {
    const out: Entity[] = [];
    for (let slot = 0; slot < this.denseLength; slot++) {
      const e = this.denseEntities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT) out.push(e as Entity);
    }
    return out;
  }

  /** Members and values in insertion order; values are live. Unlike a query, the walk does not survive a
   *  compaction, so the store must not shrink while it is open; it throws if it did. */
  *entries(): IterableIterator<[Entity, T]> {
    const epoch = this.compactions;
    for (let slot = 0; slot < this.denseLength; slot++) {
      const e = this.denseEntities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT) yield [e as Entity, this.values[slot] as T];
      if (this.compactions !== epoch)
        throw new Error('ComponentStore.entries: store compacted during the walk');
    }
  }

  private compact(): void {
    const { denseEntities: entities, denseSeqs: seqs, revisions, values } = this;
    let to = 0;
    for (let from = 0; from < this.denseLength; from++) {
      const e = entities[from] ?? VACANT_SLOT;
      if (e === VACANT_SLOT) continue;
      if (to !== from) {
        entities[to] = e;
        seqs[to] = seqs[from] ?? 0;
        revisions[to] = revisions[from] ?? 0;
        values[to] = values[from];
        const block = (this.pageTable[e >>> PAGE_BITS] as number) - 1;
        if (block >= 0) this.index[(block << PAGE_BITS) | (e & PAGE_MASK)] = to + 1;
      }
      to++;
    }
    values.length = to;
    this.denseLength = to;
    this.compactions++;
    if (entities.length > INITIAL_CAPACITY && entities.length >= to * SHRINK_FACTOR) {
      this.resize(Math.max(INITIAL_CAPACITY, to * 2));
    }
  }

  /** The index entry of `entity`, taking a block for its page first when it has none. */
  private indexEntryOrAllocate(entity: Entity): number {
    const page = entity >>> PAGE_BITS;
    if (page >= this.pageTable.length) {
      const table = new Int32Array(Math.max(page + 1, this.pageTable.length * 2));
      table.set(this.pageTable);
      this.pageTable = table;
    }
    let block = (this.pageTable[page] as number) - 1;
    if (block < 0) {
      block = this.freeBlocks.pop() ?? this.newBlock();
      this.pageTable[page] = block + 1;
    }
    return (block << PAGE_BITS) | (entity & PAGE_MASK);
  }

  private newBlock(): number {
    const block = this.blockCount++;
    if (this.blockCount > this.blockMembers.length) {
      const blocks = Math.max(1, this.blockMembers.length * 2);
      const members = new Int32Array(blocks);
      members.set(this.blockMembers);
      this.blockMembers = members;
      const index = new Int32Array(blocks << PAGE_BITS);
      index.set(this.index);
      this.index = index;
    }
    return block;
  }

  private resize(capacity: number): void {
    const entities = new Int32Array(capacity);
    entities.set(this.denseEntities.subarray(0, this.denseLength));
    this.denseEntities = entities;
    const seqs = new Float64Array(capacity);
    seqs.set(this.denseSeqs.subarray(0, this.denseLength));
    this.denseSeqs = seqs;
    const revisions = new Float64Array(capacity);
    revisions.set(this.revisions.subarray(0, this.denseLength));
    this.revisions = revisions;
  }
}
