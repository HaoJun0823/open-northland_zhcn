import type { TerrainGraph } from '../terrain/index.js';

/** The largest mark before the stamps wrap and are cleared. */
const MAX_MARK = 0x7fffffff;

/**
 * Per-node marks with one integer each, for one terrain, so indexing a long route marks it without a
 * map. A node holds a value only while its stamp equals the current mark. Users run synchronously and
 * never hold marks across another user's call, so every user of a terrain shares them.
 */
export class NodeMarks {
  readonly stamps: Int32Array;
  readonly values: Int32Array;
  private mark = 0;

  constructor(nodeCount: number) {
    this.stamps = new Int32Array(nodeCount);
    this.values = new Int32Array(nodeCount);
  }

  /** A fresh mark: no node holds it yet. */
  next(): number {
    if (this.mark === MAX_MARK) {
      this.stamps.fill(0);
      this.mark = 0;
    }
    this.mark += 1;
    return this.mark;
  }
}

const marksByTerrain = new WeakMap<TerrainGraph, NodeMarks>();

export function nodeMarksOf(terrain: TerrainGraph): NodeMarks {
  let marks = marksByTerrain.get(terrain);
  if (marks === undefined) {
    marks = new NodeMarks(terrain.nodeCount);
    marksByTerrain.set(terrain, marks);
  }
  return marks;
}
