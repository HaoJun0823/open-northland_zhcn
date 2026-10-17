import { BIT_MASK, WORD_SHIFT } from '../core/bit-words.js';
import type { Entity } from './component.js';
import { PAGE_BITS } from './component-store.js';

/** A page of {@link PAGE_BITS} ids, as in the component stores, takes a block of masks only while one of
 *  its entities carries a component; an emptied block is reused by the next new page. */
const PAGE_SIZE = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_SIZE - 1;
/** A page table entry holds `block + 1`; this marks a page without a block. */
const NO_BLOCK = 0;
const NOT_CARRIED = -1;

/**
 * Per entity, the registration indices of the components it carries, one bit each, so walking them in
 * ascending index order is walking them in registration order. The masks of all entities share one
 * paged buffer instead of a list object per entity, `stride` words per entity, widened when a component
 * registers past the bits it holds.
 */
export class EntityMemberships {
  private stride = 1;
  /** Page number to `block + 1`, {@link NO_BLOCK} while no entity of the page carries a component. */
  private pageTable = new Int32Array(0);
  /** {@link PAGE_SIZE} masks of {@link stride} words per block. */
  private masks = new Uint32Array(0);
  /** Per block, its entities carrying at least one component. */
  private blockEntities = new Int32Array(0);
  private blockCount = 0;
  private readonly freeBlocks: number[] = [];

  add(entity: Entity, index: number): void {
    const word = index >>> WORD_SHIFT;
    if (word >= this.stride) this.widen(word + 1);
    const at = this.maskOrAllocate(entity);
    if (this.isEmpty(at)) {
      const block = (this.pageTable[entity >>> PAGE_BITS] as number) - 1;
      this.blockEntities[block] = (this.blockEntities[block] as number) + 1;
    }
    this.masks[at + word] = (this.masks[at + word] as number) | (1 << (index & BIT_MASK));
  }

  remove(entity: Entity, index: number): void {
    const at = this.maskOf(entity);
    const word = index >>> WORD_SHIFT;
    if (at === NOT_CARRIED || word >= this.stride) return;
    this.masks[at + word] = (this.masks[at + word] as number) & ~(1 << (index & BIT_MASK));
    if (this.isEmpty(at)) this.release(entity);
  }

  /** Forget every component `entity` carries. */
  clear(entity: Entity): void {
    const at = this.maskOf(entity);
    if (at === NOT_CARRIED || this.isEmpty(at)) return;
    this.masks.fill(0, at, at + this.stride);
    this.release(entity);
  }

  has(entity: Entity, index: number): boolean {
    const at = this.maskOf(entity);
    const word = index >>> WORD_SHIFT;
    if (at === NOT_CARRIED || word >= this.stride) return false;
    return ((this.masks[at + word] as number) & (1 << (index & BIT_MASK))) !== 0;
  }

  /** The lowest index above `after` that `entity` carries, or -1: start from -1 and pass each answer
   *  back to walk the entity's components in registration order without allocating. */
  next(entity: Entity, after: number): number {
    const at = this.maskOf(entity);
    if (at === NOT_CARRIED) return NOT_CARRIED;
    const start = after + 1;
    let word = start >>> WORD_SHIFT;
    if (word >= this.stride) return NOT_CARRIED;
    let bits = (this.masks[at + word] as number) & (~0 << (start & BIT_MASK));
    for (;;) {
      if (bits !== 0) return (word << WORD_SHIFT) + BIT_MASK - Math.clz32(bits & -bits);
      word++;
      if (word >= this.stride) return NOT_CARRIED;
      bits = this.masks[at + word] as number;
    }
  }

  /** Every carried (entity, index) pair, for the cache verifier. */
  forEachCarried(visit: (entity: Entity, index: number) => void): void {
    for (let page = 0; page < this.pageTable.length; page++) {
      if (this.pageTable[page] === NO_BLOCK) continue;
      for (let offset = 0; offset < PAGE_SIZE; offset++) {
        const entity = ((page << PAGE_BITS) | offset) as Entity;
        for (let index = this.next(entity, -1); index >= 0; index = this.next(entity, index)) {
          visit(entity, index);
        }
      }
    }
  }

  /** The first mask word of `entity`, or {@link NOT_CARRIED} while its page holds no block. */
  private maskOf(entity: Entity): number {
    const page = entity >>> PAGE_BITS;
    if (page >= this.pageTable.length) return NOT_CARRIED;
    const block = this.pageTable[page] as number;
    if (block === NO_BLOCK) return NOT_CARRIED;
    return (((block - 1) << PAGE_BITS) | (entity & PAGE_MASK)) * this.stride;
  }

  private isEmpty(at: number): boolean {
    for (let w = 0; w < this.stride; w++) if (this.masks[at + w] !== 0) return false;
    return true;
  }

  /** `entity` carries nothing any more: its block loses an entity, and an emptied block is freed. */
  private release(entity: Entity): void {
    const page = entity >>> PAGE_BITS;
    const block = (this.pageTable[page] as number) - 1;
    const left = (this.blockEntities[block] as number) - 1;
    this.blockEntities[block] = left;
    if (left === 0) {
      this.pageTable[page] = NO_BLOCK;
      this.freeBlocks.push(block);
    }
  }

  private maskOrAllocate(entity: Entity): number {
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
    return ((block << PAGE_BITS) | (entity & PAGE_MASK)) * this.stride;
  }

  private newBlock(): number {
    const block = this.blockCount++;
    if (this.blockCount > this.blockEntities.length) {
      const blocks = Math.max(1, this.blockEntities.length * 2);
      const entities = new Int32Array(blocks);
      entities.set(this.blockEntities);
      this.blockEntities = entities;
      const masks = new Uint32Array(blocks * PAGE_SIZE * this.stride);
      masks.set(this.masks);
      this.masks = masks;
    }
    return block;
  }

  /** Re-lay every mask at `stride` words, keeping its bits. */
  private widen(stride: number): void {
    const from = this.masks;
    const old = this.stride;
    const slots = from.length / old;
    const masks = new Uint32Array(slots * stride);
    for (let slot = 0; slot < slots; slot++) {
      for (let w = 0; w < old; w++) masks[slot * stride + w] = from[slot * old + w] as number;
    }
    this.masks = masks;
    this.stride = stride;
  }
}
