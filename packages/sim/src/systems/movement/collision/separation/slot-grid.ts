import { BIT_MASK, BITS_PER_WORD, WORD_SHIFT } from '../../../../core/bit-words.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';

/** Marks an empty list head or the end of a node's list; slots are stored one-based. */
const NO_SLOT = 0;

/** Nodes per side of the block {@link SlotGrid.collectAround} scans: the node and its eight neighbours. */
const BLOCK_SIDE = 3;

/** A block row's three occupancy bits, and the two beside its centre node. */
const ROW_BITS = 0b111;
const SIDE_BITS = 0b101;

/**
 * Collider slots grouped by half-cell node, rebuilt every tick: a list head per terrain node plus one link
 * per slot, so a lookup is two array reads where a keyed bucket map hashed every probe. Each node's list is
 * ascending by slot. A slot whose node lies off the lattice goes to an overflow list scanned in slot order,
 * so an off-map body still meets its neighbours as a bucketed one would.
 */
export class SlotGrid {
  private terrain: TerrainGraph | undefined;
  private width = 0;
  private height = 0;
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  /** 1 where a lower slot shares the slot's node: with {@link next}, whether the slot has a node-mate. */
  private hasLower = new Uint8Array(0);
  /** One bit per node holding a slot, so an empty neighbourhood is told from a few cached words. */
  private occupied = new Uint32Array(0);
  /** The node each slot of the current fill was listed on, or -1 for an overflow slot. */
  private nodeOf = new Int32Array(0);
  private filled = 0;
  private readonly overflow: number[] = [];
  private overflowCount = 0;
  private hxOf: readonly number[] = [];
  private hyOf: readonly number[] = [];

  /** List slots `0..count-1` on node `(hx[slot], hy[slot])`. */
  fill(terrain: TerrainGraph, count: number, hx: readonly number[], hy: readonly number[]): void {
    this.clear(terrain);
    if (this.next.length < count) {
      const size = Math.max(count, this.next.length * 2);
      this.next = new Int32Array(size);
      this.hasLower = new Uint8Array(size);
      this.nodeOf = new Int32Array(size);
    }
    const { head, next, hasLower, occupied } = this;
    // Descending head insertion leaves every node's list ascending.
    for (let slot = count - 1; slot >= 0; slot--) {
      hasLower[slot] = 0;
      const x = hx[slot] ?? 0;
      const y = hy[slot] ?? 0;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
        this.nodeOf[slot] = -1;
        continue;
      }
      const node = y * this.width + x;
      this.nodeOf[slot] = node;
      const higher = head[node] ?? NO_SLOT;
      if (higher !== NO_SLOT) hasLower[higher - 1] = 1;
      next[slot] = higher;
      head[node] = slot + 1;
      occupied[node >>> WORD_SHIFT] = (occupied[node >>> WORD_SHIFT] ?? 0) | (1 << (node & BIT_MASK));
    }
    this.overflowCount = 0;
    for (let slot = 0; slot < count; slot++) {
      if (this.nodeOf[slot] === -1) this.overflow[this.overflowCount++] = slot;
    }
    this.hxOf = hx;
    this.hyOf = hy;
    this.filled = count;
  }

  /** Append node `(x, y)`'s slots to `out` from index `at`, ascending, and return the new count. */
  collect(x: number, y: number, out: number[], at: number): number {
    let count = at;
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      for (let s = this.head[y * this.width + x] ?? NO_SLOT; s !== NO_SLOT; s = this.next[s - 1] ?? NO_SLOT) {
        out[count++] = s - 1;
      }
      return count;
    }
    for (let i = 0; i < this.overflowCount; i++) {
      const slot = this.overflow[i] ?? 0;
      if (this.hxOf[slot] === x && this.hyOf[slot] === y) out[count++] = slot;
    }
    return count;
  }

  /**
   * Append the slots on the 3x3 node block around `slot`'s node to `out` from index 0, except `slot`
   * itself, node by node in `collect`'s column-major order (x outer, y inner), and return the count. A
   * block wholly on the lattice is first ruled empty from the occupancy bits, then reads its heads
   * directly; one touching an edge goes node by node.
   */
  collectAround(slot: number, out: number[]): number {
    const x = this.hxOf[slot] ?? 0;
    const y = this.hyOf[slot] ?? 0;
    let count = 0;
    if (x < 1 || y < 1 || x + 1 >= this.width || y + 1 >= this.height) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) count = this.collect(x + dx, y + dy, out, count);
      }
      return dropSlot(out, count, slot);
    }
    const { head, next, width } = this;
    const centre = y * width + x;
    const alone =
      next[slot] === NO_SLOT &&
      this.hasLower[slot] === 0 &&
      this.rowBits(centre - width - 1) === 0 &&
      (this.rowBits(centre - 1) & SIDE_BITS) === 0 &&
      this.rowBits(centre + width - 1) === 0;
    if (alone) return 0;
    const skipLink = slot + 1;
    for (let column = x - 1; column <= x + 1; column++) {
      for (let node = (y - 1) * width + column, row = 0; row < BLOCK_SIDE; row++, node += width) {
        for (let s = head[node] ?? NO_SLOT; s !== NO_SLOT; s = next[s - 1] ?? NO_SLOT) {
          if (s !== skipLink) out[count++] = s - 1;
        }
      }
    }
    return count;
  }

  /** The occupancy bits of `first` and the two nodes after it, lowest bit first. */
  private rowBits(first: number): number {
    const word = first >>> WORD_SHIFT;
    const bit = first & BIT_MASK;
    let bits = (this.occupied[word] ?? 0) >>> bit;
    if (bit > BITS_PER_WORD - BLOCK_SIDE) bits |= (this.occupied[word + 1] ?? 0) << (BITS_PER_WORD - bit);
    return bits & ROW_BITS;
  }

  /** Empty the previous fill's lists, re-sizing the heads when the terrain changed. */
  private clear(terrain: TerrainGraph): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain;
      this.width = terrain.width;
      this.height = terrain.height;
      this.head = new Int32Array(terrain.nodeCount);
      this.occupied = new Uint32Array(Math.ceil(terrain.nodeCount / BITS_PER_WORD));
      this.filled = 0;
      return;
    }
    for (let slot = 0; slot < this.filled; slot++) {
      const node = this.nodeOf[slot] ?? -1;
      if (node < 0) continue;
      this.head[node] = NO_SLOT;
      this.occupied[node >>> WORD_SHIFT] = 0;
    }
  }
}

/** Remove `slot` from the first `count` entries of `list`, keeping their order; returns the new count. */
function dropSlot(list: number[], count: number, slot: number): number {
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const n = list[i] ?? slot;
    if (n !== slot) list[kept++] = n;
  }
  return kept;
}
