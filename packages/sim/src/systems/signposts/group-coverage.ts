import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import { type NodeBox, unionNodeBoxes } from '../../nav/node-circle.js';
import { type ReachArea, reachBox } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SignpostSite } from './network.js';
import { GOODS_SEARCH_SPAN, postTerrainReach } from './terrain-reach.js';

/** Nodes per side of the blocks a coverage re-checks its posts by. */
const COVERAGE_BLOCK_NODES = 16;
/** The epoch reading of a post or block never checked. */
const UNCHECKED = -1;

/**
 * A signpost group's goods coverage: the nodes some post's goods search marks. It keeps each post's
 * search and, per node, how many of those searches mark it. Asked about a node, it re-checks only the
 * posts whose search box meets that node's block, once per reach epoch, so a node's count is exact
 * whatever the other posts hold, and a post whose search changed costs its own area, not a new union.
 */
export class GroupCoverage {
  /** The union of the posts' search boxes, whatever the searches mark. */
  readonly bounds: NodeBox;
  private readonly width: number;
  private readonly counts: Uint16Array;
  private readonly held: (ReachArea | undefined)[];
  private readonly postCheckedAt: Float64Array;
  private readonly blockColumns: number;
  /** Per block, the posts whose search box meets it. */
  private readonly blockPosts: number[][];
  private readonly blockCheckedAt: Float64Array;

  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
    private readonly terrain: TerrainGraph,
    readonly posts: readonly SignpostSite[],
  ) {
    const range = GOODS_SEARCH_SPAN.range;
    const boxes = posts.map((p) => reachBox(terrain, p.hx, p.hy, range));
    this.bounds = unionNodeBoxes(boxes);
    const { minX, maxX, minY, maxY } = this.bounds;
    this.width = Math.max(0, maxX - minX + 1);
    const height = Math.max(0, maxY - minY + 1);
    this.counts = new Uint16Array(this.width * height);
    this.held = posts.map(() => undefined);
    this.postCheckedAt = new Float64Array(posts.length).fill(UNCHECKED);
    this.blockColumns = Math.ceil(this.width / COVERAGE_BLOCK_NODES);
    const blockRows = Math.ceil(height / COVERAGE_BLOCK_NODES);
    this.blockPosts = Array.from({ length: this.blockColumns * blockRows }, () => []);
    this.blockCheckedAt = new Float64Array(this.blockPosts.length).fill(UNCHECKED);
    boxes.forEach((box, i) => {
      if (box.minX > box.maxX || box.minY > box.maxY) return;
      const lastRow = Math.floor((box.maxY - minY) / COVERAGE_BLOCK_NODES);
      const lastColumn = Math.floor((box.maxX - minX) / COVERAGE_BLOCK_NODES);
      for (let row = Math.floor((box.minY - minY) / COVERAGE_BLOCK_NODES); row <= lastRow; row++)
        for (
          let column = Math.floor((box.minX - minX) / COVERAGE_BLOCK_NODES);
          column <= lastColumn;
          column++
        )
          (this.blockPosts[row * this.blockColumns + column] as number[]).push(i);
    });
  }

  /** Whether some post's goods search marks `(x, y)`, with the posts' searches current as of reach
   *  `epoch`, a reading that moves with every mask or road change. */
  covers(x: number, y: number, epoch: number): boolean {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const block =
      Math.floor((y - minY) / COVERAGE_BLOCK_NODES) * this.blockColumns +
      Math.floor((x - minX) / COVERAGE_BLOCK_NODES);
    if (this.blockCheckedAt[block] !== epoch) {
      for (const i of this.blockPosts[block] as number[]) this.checkPost(i, epoch);
      this.blockCheckedAt[block] = epoch;
    }
    return this.counts[(y - minY) * this.width + x - minX] !== 0;
  }

  private checkPost(i: number, epoch: number): void {
    if (this.postCheckedAt[i] === epoch) return;
    this.postCheckedAt[i] = epoch;
    const post = this.posts[i] as SignpostSite;
    const { world, content, terrain } = this;
    const found = postTerrainReach(world, content, terrain, post.entity, post.hx, post.hy, GOODS_SEARCH_SPAN);
    const held = this.held[i];
    if (found.area === held) return;
    if (held !== undefined) this.count(held, -1);
    this.count(found.area, 1);
    this.held[i] = found.area;
  }

  /** Add `sign` times each node `area` marks to the counts. */
  private count(area: ReachArea, sign: number): void {
    const areaWidth = area.maxX - area.minX + 1;
    const { minX, minY } = this.bounds;
    const counts = this.counts;
    const cells = area.cells;
    for (let y = area.minY; y <= area.maxY; y++) {
      const from = (y - area.minY) * areaWidth;
      const to = (y - minY) * this.width + area.minX - minX;
      // Cells hold only 0 or 1, so the product is the change without a branch per cell.
      for (let x = 0; x < areaWidth; x++)
        counts[to + x] = (counts[to + x] as number) + sign * (cells[from + x] as number);
    }
  }
}
