import type { Entity } from '../../ecs/world.js';

/** The held `hx` of an entity without a node: the Int32 minimum, which no node's `hx` reaches. An
 *  off-map entity's node is negative, so no smaller sentinel is safe. */
export const NO_NODE = -(2 ** 31);

/** One half-cell node per entity id in two typed columns, {@link NO_NODE} in `hx` for none, so an index
 *  that tracks where each entity stands allocates nothing per move. */
export class HeldNodes {
  private hxs = new Int32Array(0);
  private hys = new Int32Array(0);

  /** Forget every node and size the columns for ids below `idLimit`. */
  reset(idLimit: number): void {
    this.hxs = new Int32Array(idLimit).fill(NO_NODE);
    this.hys = new Int32Array(idLimit);
  }

  /** Forget every node, keeping the columns' size. */
  clear(): void {
    this.hxs.fill(NO_NODE);
  }

  get size(): number {
    return this.hxs.length;
  }

  hx(e: Entity): number {
    return e < this.hxs.length ? (this.hxs[e] as number) : NO_NODE;
  }

  hy(e: Entity): number {
    return e < this.hys.length ? (this.hys[e] as number) : 0;
  }

  /** Hold `(hx, hy)` for `e`, growing the columns past `idLimit` when `e` is beyond them. */
  set(e: Entity, hx: number, hy: number, idLimit: number): void {
    if (e >= this.hxs.length) this.grow(Math.max(idLimit, e + 1, 2 * this.hxs.length));
    this.hxs[e] = hx;
    this.hys[e] = hy;
  }

  private grow(size: number): void {
    const hxs = new Int32Array(size).fill(NO_NODE);
    hxs.set(this.hxs);
    const hys = new Int32Array(size);
    hys.set(this.hys);
    this.hxs = hxs;
    this.hys = hys;
  }
}
