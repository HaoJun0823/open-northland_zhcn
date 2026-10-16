import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeBox } from '../../../nav/node-circle.js';
import { NodeBuckets } from '../../spatial/nodes.js';

/** Candidate counts per coordinate along one axis, so the span tightens once an edge coordinate empties. */
class AxisSpan {
  private readonly counts = new Map<number, number>();
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;

  add(v: number): void {
    this.counts.set(v, (this.counts.get(v) ?? 0) + 1);
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  remove(v: number): void {
    const left = (this.counts.get(v) ?? 1) - 1;
    if (left > 0) {
      this.counts.set(v, left);
      return;
    }
    this.counts.delete(v);
    if (v !== this.min && v !== this.max) return;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
    for (const held of this.counts.keys()) {
      if (held < this.min) this.min = held;
      if (held > this.max) this.max = held;
    }
  }
}

/** Nodes per side of a {@link CellGrid} tile, a power of two. */
const TILE_SHIFT = 3;
const TILE_SIZE = 1 << TILE_SHIFT;
/** Nodes per side of a {@link CellGrid} block, the coarse level a search past the ring cap walks: eight
 *  tiles, a power of two. */
const BLOCK_SHIFT = TILE_SHIFT + 3;
const BLOCK_SIZE = 1 << BLOCK_SHIFT;
/** Packs a node or a tile into one key; coordinates stay below it on every map. */
const GRID_KEY_STRIDE = 1 << 16;

/** Candidates bucketed by node coordinates, with the span of the occupied nodes so a search never
 *  expands past the farthest bucket, the occupied nodes of each square tile so a search reads only
 *  occupied nodes, nearest tiles first, and the occupied tiles of each block for a search past the ring
 *  cap. */
export class CellGrid {
  private readonly buckets: NodeBuckets;
  private readonly xs = new AxisSpan();
  private readonly ys = new AxisSpan();
  /** Each tile's occupied nodes as packed keys, ascending. */
  private readonly tiles = new Map<number, number[]>();
  /** Each block's occupied tiles as packed keys, ascending. */
  private readonly blocks = new Map<number, number[]>();
  /** Occupied nodes. */
  size = 0;

  constructor(world: World) {
    this.buckets = new NodeBuckets(world, []);
  }

  add(e: Entity, x: number, y: number): void {
    if (this.buckets.at(x, y).length === 0) {
      this.size++;
      const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
      let nodes = this.tiles.get(tile);
      if (nodes === undefined) {
        nodes = [];
        this.tiles.set(tile, nodes);
        const block = (x >> BLOCK_SHIFT) * GRID_KEY_STRIDE + (y >> BLOCK_SHIFT);
        let tiles = this.blocks.get(block);
        if (tiles === undefined) {
          tiles = [];
          this.blocks.set(block, tiles);
        }
        insertSortedById(tiles, tile, nodeKey);
      }
      insertSortedById(nodes, x * GRID_KEY_STRIDE + y, nodeKey);
    }
    this.buckets.insert(e, x, y);
    this.xs.add(x);
    this.ys.add(y);
  }

  /** Drop `e`, which {@link add} placed at `(x,y)`. */
  remove(e: Entity, x: number, y: number): void {
    this.buckets.remove(e, x, y);
    if (this.buckets.at(x, y).length === 0) {
      this.size--;
      const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
      const nodes = this.tiles.get(tile);
      if (nodes !== undefined) {
        removeSortedById(nodes, x * GRID_KEY_STRIDE + y, nodeKey);
        if (nodes.length === 0) {
          this.tiles.delete(tile);
          const block = (x >> BLOCK_SHIFT) * GRID_KEY_STRIDE + (y >> BLOCK_SHIFT);
          const tiles = this.blocks.get(block);
          if (tiles !== undefined) {
            removeSortedById(tiles, tile, nodeKey);
            if (tiles.length === 0) this.blocks.delete(block);
          }
        }
      }
    }
    this.xs.remove(x);
    this.ys.remove(y);
  }

  /**
   * Hand `visit` every occupied node within Manhattan `maxRadius` of `(x,y)` with its distance and bucket,
   * tile by tile in order of each tile's least distance. `visit` returns the distance past which no node
   * can still win; the search stops once every node left lies more than `slack` past it.
   */
  nearestFirst(
    x: number,
    y: number,
    maxRadius: number,
    slack: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    // Call-local, since a visit may search this grid again.
    const tileNodes: (readonly number[])[] = [];
    const tileDistances: number[] = [];
    const tileOrder: number[] = [];
    const minTx = Math.max(0, x - maxRadius) >> TILE_SHIFT;
    const maxTx = (x + maxRadius) >> TILE_SHIFT;
    const minTy = Math.max(0, y - maxRadius) >> TILE_SHIFT;
    const maxTy = (y + maxRadius) >> TILE_SHIFT;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const dx = Math.max(0, tx * TILE_SIZE - x, x - (tx * TILE_SIZE + TILE_SIZE - 1));
      for (let ty = minTy; ty <= maxTy; ty++) {
        const nodes = this.tiles.get(tx * GRID_KEY_STRIDE + ty);
        if (nodes === undefined) continue;
        const least = dx + Math.max(0, ty * TILE_SIZE - y, y - (ty * TILE_SIZE + TILE_SIZE - 1));
        if (least > maxRadius) continue;
        tileOrder.push(tileNodes.length);
        tileNodes.push(nodes);
        tileDistances.push(least);
      }
    }
    tileOrder.sort((a, b) => (tileDistances[a] as number) - (tileDistances[b] as number));
    let bound = Number.POSITIVE_INFINITY;
    for (const i of tileOrder) {
      if ((tileDistances[i] as number) - slack > bound) return;
      for (const key of tileNodes[i] as readonly number[]) {
        const nx = Math.floor(key / GRID_KEY_STRIDE);
        const ny = key - nx * GRID_KEY_STRIDE;
        const distance = Math.abs(nx - x) + Math.abs(ny - y);
        if (distance > maxRadius || distance - slack > bound) continue;
        bound = visit(nx, ny, distance, this.buckets.at(nx, ny));
      }
    }
  }

  /**
   * {@link nearestFirst} for the occupied nodes past Manhattan `near` and within `maxRadius` of `(x,y)`,
   * block by block in order of each block's least distance, skipping a block that misses `box`, the node
   * box a winner must lie within `slack` of. `bound` is the distance a winner found before already holds.
   */
  farFirst(
    x: number,
    y: number,
    near: number,
    maxRadius: number,
    slack: number,
    box: NodeBox | undefined,
    bound: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    // Call-local, since a visit may search this grid again.
    const blockTiles: (readonly number[])[] = [];
    const blockDistances: number[] = [];
    const blockOrder: number[] = [];
    this.blocks.forEach((tiles, key) => {
      const bx = Math.floor(key / GRID_KEY_STRIDE);
      const by = key - bx * GRID_KEY_STRIDE;
      const minX = bx << BLOCK_SHIFT;
      const minY = by << BLOCK_SHIFT;
      const least = spanGap(x, minX, BLOCK_SIZE) + spanGap(y, minY, BLOCK_SIZE);
      if (least > maxRadius || least - slack > bound) return;
      if (box !== undefined && !squareNearBox(box, minX, minY, BLOCK_SIZE, slack)) return;
      blockOrder.push(blockTiles.length);
      blockTiles.push(tiles);
      blockDistances.push(least);
    });
    blockOrder.sort((a, b) => (blockDistances[a] as number) - (blockDistances[b] as number));
    const tileNodes: (readonly number[])[] = [];
    const tileDistances: number[] = [];
    const tileOrder: number[] = [];
    for (const i of blockOrder) {
      if ((blockDistances[i] as number) - slack > bound) return;
      tileNodes.length = 0;
      tileDistances.length = 0;
      tileOrder.length = 0;
      for (const tile of blockTiles[i] as readonly number[]) {
        const tx = Math.floor(tile / GRID_KEY_STRIDE);
        const ty = tile - tx * GRID_KEY_STRIDE;
        const minX = tx << TILE_SHIFT;
        const minY = ty << TILE_SHIFT;
        const least = spanGap(x, minX, TILE_SIZE) + spanGap(y, minY, TILE_SIZE);
        if (least > maxRadius || least - slack > bound) continue;
        if (spanReach(x, minX, TILE_SIZE) + spanReach(y, minY, TILE_SIZE) <= near) continue;
        const nodes = this.tiles.get(tile);
        if (nodes === undefined) continue; // a block lists only occupied tiles
        tileOrder.push(tileNodes.length);
        tileNodes.push(nodes);
        tileDistances.push(least);
      }
      tileOrder.sort((a, b) => (tileDistances[a] as number) - (tileDistances[b] as number));
      for (const j of tileOrder) {
        if ((tileDistances[j] as number) - slack > bound) break;
        for (const key of tileNodes[j] as readonly number[]) {
          const nx = Math.floor(key / GRID_KEY_STRIDE);
          const ny = key - nx * GRID_KEY_STRIDE;
          const distance = Math.abs(nx - x) + Math.abs(ny - y);
          if (distance <= near || distance > maxRadius || distance - slack > bound) continue;
          bound = visit(nx, ny, distance, this.buckets.at(nx, ny));
        }
      }
    }
  }

  /** Node `(x,y)`'s candidates, ascending-id. */
  at(x: number, y: number): readonly Entity[] {
    return this.buckets.at(x, y);
  }

  /** The ring radius from `(x,y)` covering every bucket, or -1 when there is none. */
  reach(x: number, y: number): number {
    if (this.size === 0) return -1;
    const { xs, ys } = this;
    return Math.max(x - xs.min, xs.max - x) + Math.max(y - ys.min, ys.max - y);
  }
}

const nodeKey = (key: number): number => key;

/** The gap along one axis from `v` to the span `[min, min + size - 1]`, 0 inside it. */
function spanGap(v: number, min: number, size: number): number {
  return Math.max(0, min - v, v - (min + size - 1));
}

/** The farthest any coordinate of the span `[min, min + size - 1]` lies from `v` along one axis. */
function spanReach(v: number, min: number, size: number): number {
  return Math.max(v - min, min + size - 1 - v);
}

/** Whether the square of side `size` from `(minX, minY)` holds a node within `slack` of `box` on both
 *  axes. */
function squareNearBox(box: NodeBox, minX: number, minY: number, size: number, slack: number): boolean {
  return (
    minX + size - 1 >= box.minX - slack &&
    minX <= box.maxX + slack &&
    minY + size - 1 >= box.minY - slack &&
    minY <= box.maxY + slack
  );
}
