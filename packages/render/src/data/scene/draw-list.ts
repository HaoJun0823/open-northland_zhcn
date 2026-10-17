import type { MutableSpriteDrawItem } from './draw-item.js';

/**
 * A scene build's draw item array, presized to the last build's count: pushed one by one onto an empty
 * array, a wide view's items regrow and copy the array a dozen times per build.
 */
export class DrawList {
  private items: MutableSpriteDrawItem[] = [];
  private count = 0;

  /** Start a build on a fresh array; the array the last {@link finish} returned is left as it is. */
  begin(): void {
    this.items = new Array<MutableSpriteDrawItem>(this.count);
    this.count = 0;
  }

  push(item: MutableSpriteDrawItem): void {
    this.items[this.count] = item;
    this.count++;
  }

  /** Items pushed since {@link begin}. */
  get size(): number {
    return this.count;
  }

  /** The item pushed `index`-th since {@link begin}. */
  at(index: number): MutableSpriteDrawItem | undefined {
    return index < this.count ? this.items[index] : undefined;
  }

  /** The build's items, trimmed to those pushed. */
  finish(): MutableSpriteDrawItem[] {
    this.items.length = this.count;
    return this.items;
  }
}
