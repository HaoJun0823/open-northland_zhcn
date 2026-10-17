import { isVisible, type Viewport } from '../projection/index.js';
import type { SpriteDrawItem } from './draw-item.js';

/** Entries past this many per live item make a pan over one snapshot drop the stale ones. */
const STALE_ENTRY_FACTOR = 4;

/**
 * The screen point each emitted item of one snapshot was culled on: its entity's drawn anchor, which an
 * item's own position may leave (a palisade's stagger, a projectile's arc, a craft effect's offset). A
 * build appends as it emits, a few array writes per item; the item lookup is built only when a pan
 * over the same snapshot asks which items the new view still shows.
 */
export class CullAnchors {
  private items: SpriteDrawItem[] = [];
  private xs: number[] = [];
  private ys: number[] = [];
  private count = 0;
  private index: Map<SpriteDrawItem, number> | null = null;

  /** Forget every entry: the items of another snapshot are never asked about. The arrays keep their
   *  capacity for the next build. */
  reset(): void {
    this.count = 0;
    this.index = null;
  }

  record(item: SpriteDrawItem, x: number, y: number): void {
    const at = this.count++;
    this.items[at] = item;
    this.xs[at] = x;
    this.ys[at] = y;
    this.index?.set(item, at);
  }

  /** Whether `item`'s cull anchor lies in `view`; false for an item never recorded. */
  shownIn(item: SpriteDrawItem, view: Viewport): boolean {
    const at = this.lookup().get(item);
    if (at === undefined) return false;
    return isVisible(view, this.xs[at] ?? Number.NaN, this.ys[at] ?? Number.NaN);
  }

  /** Keep only the entries of `live`, once the entries of items a pan dropped outnumber them. */
  compact(live: readonly SpriteDrawItem[]): void {
    if (this.count <= STALE_ENTRY_FACTOR * Math.max(1, live.length)) return;
    const index = this.lookup();
    const xs: number[] = [];
    const ys: number[] = [];
    const items: SpriteDrawItem[] = [];
    for (const item of live) {
      const at = index.get(item);
      if (at === undefined) continue;
      items.push(item);
      xs.push(this.xs[at] ?? Number.NaN);
      ys.push(this.ys[at] ?? Number.NaN);
    }
    this.items = items;
    this.xs = xs;
    this.ys = ys;
    this.count = items.length;
    this.index = null;
  }

  private lookup(): Map<SpriteDrawItem, number> {
    if (this.index !== null) return this.index;
    const index = new Map<SpriteDrawItem, number>();
    for (let at = 0; at < this.count; at++) {
      const item = this.items[at];
      if (item !== undefined) index.set(item, at);
    }
    this.index = index;
    return index;
  }
}
