/**
 * A node's edges to its six lattice neighbours: the pathfinder's single steps, and the adjacency of every
 * search that decides where a walker can step, such as stands, evictions and door passages. The range
 * floods (`range-search.ts`) walk the same six neighbours without the edge gate. Source basis for the set: `THexagonDirection` in the shipped `Data/GameSourceIncludes/logicdefines.inc`
 * (E, SE, SW, W, NW, NE, then NORTH = 6 and SOUTH = 7, which no route takes). Original behavior: the
 * route search expands only those six, each gated by the map's per-node edge lane, on a lattice whose
 * odd rows sit half a node to +x. In integer coordinates that shift is the parity rule of the
 * row-crossing edges: from an even row NE and SE keep the column and NW and SW shift a column west,
 * from an odd row NW and SW keep it and NE and SE shift a column east. The edges connect exactly what
 * the original's connect, and all four row-crossing edges are one length (`ROW_EDGE`), so the pathfinder
 * takes these six steps alone.
 *
 * Neighbours are emitted in a fixed canonical order so traversal is byte-identical across runs.
 */
import { HEX_EDGE, HEX_EDGE_COUNT, hexEdgeNeighbourX, hexEdgeNeighbourY } from '@open-northland/data';
import { type BlockOverlay, NodeMask } from '../block-overlay.js';
import { HALF_COLUMN, ROW_EDGE } from '../world-metric.js';

import { TerrainLattice, type Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { type Step, StepBuffer } from './step-buffer.js';

/** One bit per original edge direction, as the ground edge lane stores them. */
const EAST = 1 << HEX_EDGE.EAST;
const SOUTH_EAST = 1 << HEX_EDGE.SOUTH_EAST;
const SOUTH_WEST = 1 << HEX_EDGE.SOUTH_WEST;
const WEST = 1 << HEX_EDGE.WEST;
const NORTH_WEST = 1 << HEX_EDGE.NORTH_WEST;
const NORTH_EAST = 1 << HEX_EDGE.NORTH_EAST;
const ALL_EDGES = (1 << HEX_EDGE_COUNT) - 1;

/** The six edges in bit order, the canonical neighbour order: E, SE, SW, W, NW, NE. */
const EDGE_BITS: readonly number[] = [EAST, SOUTH_EAST, SOUTH_WEST, WEST, NORTH_WEST, NORTH_EAST];
const EVEN_ROW = 0;
const ODD_ROW = 1;
/** Each edge's column offset from an even row and from an odd row, and its row offset. */
const EDGE_DX_EVEN: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourX(0, EVEN_ROW, edge));
const EDGE_DX_ODD: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourX(0, ODD_ROW, edge));
const EDGE_DY: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourY(0, edge));
/** The column a slant edge shifts from an even row (SW and NW) and from an odd one (SE and NE). */
const SLANT_DX_EVEN = hexEdgeNeighbourX(0, EVEN_ROW, HEX_EDGE.SOUTH_WEST);
const SLANT_DX_ODD = hexEdgeNeighbourX(0, ODD_ROW, HEX_EDGE.SOUTH_EAST);

/** The column the two slant edges of row `y` shift, up or down: -1 (west) from an even row, +1 (east)
 *  from an odd one. A walk heading `dx` can take a slant from row `y` only when `dx * slantDx(y) > 0`. */
export function slantDx(y: number): number {
  return (y & 1) === 0 ? SLANT_DX_EVEN : SLANT_DX_ODD;
}

export abstract class TerrainEdges extends TerrainLattice {
  /** The in-bounds lattice neighbours of a node, in canonical order, whatever the ground between. */
  neighbours(node: NodeId): NodeId[] {
    const out: NodeId[] = [];
    this.neighboursInto(node, out);
    return out;
  }

  /** {@link neighbours} written into `out` from index 0, for a loop that reuses one array; returns how
   *  many it wrote. */
  neighboursInto(node: NodeId, out: NodeId[]): number {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    let count = 0;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      const nx = x + (dxs[i] ?? 0);
      const ny = y + (EDGE_DY[i] ?? 0);
      if (this.inBounds(nx, ny)) out[count++] = this.idAt(nx, ny);
    }
    return count;
  }

  /**
   * The walkable subset of {@link neighbours} a walkable `node` is {@link joined} to, in the same order:
   * the nodes a walker standing on `node` can step to in one edge.
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    const out: NodeId[] = [];
    this.walkableNeighboursInto(node, out);
    return out;
  }

  /** {@link walkableNeighbours} written into `out` from index 0, for a loop that reuses one array; returns
   *  how many it wrote. */
  walkableNeighboursInto(node: NodeId, out: NodeId[]): number {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    // A node no walker stands on, a trunk or a rock, borders its neighbours rather than stepping to them.
    const edges = this.isWalkable(node) ? this.edgeMaskAt(node) : ALL_EDGES;
    let count = 0;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      if ((edges & (EDGE_BITS[i] ?? 0)) === 0) continue;
      const nx = x + (dxs[i] ?? 0);
      const ny = y + (EDGE_DY[i] ?? 0);
      if (!this.inBounds(nx, ny)) continue;
      const c = this.idAt(nx, ny);
      if (this.isWalkable(c)) out[count++] = c;
    }
    return count;
  }

  /**
   * The pathfinder's edge set from `node`: the six lattice edges in canonical order. A step costs the
   * edge's world length; the pathfinder weighs it by the destination's ground. A step onto a blocked or
   * unwalkable destination is omitted, and so is one along ground the original's edges do not join.
   *
   * The allocating form; hot callers use {@link stepsInto}.
   */
  steps(node: NodeId, blocked?: BlockOverlay): Step[] {
    const buf = new StepBuffer();
    this.stepsInto(node, blocked, buf);
    const out: Step[] = [];
    for (let i = 0; i < buf.length; i++) {
      const step = buf.at(i);
      out.push({ node: step.node, cost: step.cost });
    }
    return out;
  }

  /** {@link steps} emitted into a caller-owned buffer, which is reset first. */
  stepsInto(
    node: NodeId,
    blocked: BlockOverlay | undefined,
    out: StepBuffer,
    traversal: Traversal = 'land',
  ): void {
    const y = this.yOf(node);
    this.stepsIntoAt(node, node - y * this.width, y, blocked, out, traversal);
  }

  /** {@link stepsInto} for a caller that already holds `node`'s column `x` and row `y`. */
  stepsIntoAt(
    node: NodeId,
    x: number,
    y: number,
    blocked: BlockOverlay | undefined,
    out: StepBuffer,
    traversal: Traversal,
  ): void {
    // A byte mask is read in place: one array read instead of a call through the overlay interface.
    const bytes = blocked instanceof NodeMask ? blocked.blocked : undefined;
    const land = traversal === 'land';
    const width = this.width;
    out.reset();
    const east = x + 1 < width;
    const west = x > 0;
    const up = y > 0;
    const down = y + 1 < this.height;
    const odd = (y & 1) !== 0;
    const edges = this.edgeMaskAt(node);
    // The edge tables unrolled, since this is the pathfinder's inner loop. The row-crossing landings by
    // this row's parity (the module header); ids are meaningful only where the matching bound holds.
    const northEast = odd ? node - width + 1 : node - width;
    const northWest = odd ? node - width : node - width - 1;
    const southEast = odd ? node + width + 1 : node + width;
    const southWest = odd ? node + width : node + width - 1;
    const eastwardIn = odd ? east : true;
    const westwardIn = odd ? true : west;
    if (east && (edges & EAST) !== 0 && this.open(node + 1, blocked, bytes, land)) {
      out.push((node + 1) as NodeId, HALF_COLUMN);
    }
    if (down && eastwardIn && (edges & SOUTH_EAST) !== 0 && this.open(southEast, blocked, bytes, land)) {
      out.push(southEast as NodeId, ROW_EDGE);
    }
    if (down && westwardIn && (edges & SOUTH_WEST) !== 0 && this.open(southWest, blocked, bytes, land)) {
      out.push(southWest as NodeId, ROW_EDGE);
    }
    if (west && (edges & WEST) !== 0 && this.open(node - 1, blocked, bytes, land)) {
      out.push((node - 1) as NodeId, HALF_COLUMN);
    }
    if (up && westwardIn && (edges & NORTH_WEST) !== 0 && this.open(northWest, blocked, bytes, land)) {
      out.push(northWest as NodeId, ROW_EDGE);
    }
    if (up && eastwardIn && (edges & NORTH_EAST) !== 0 && this.open(northEast, blocked, bytes, land)) {
      out.push(northEast as NodeId, ROW_EDGE);
    }
  }

  /**
   * Whether the ground joins `node` to `next`, one of its {@link neighbours}: the original's edge between
   * them is open, or the map carries no edges. False for a node that is no lattice neighbour. A search
   * over the neighbours asks it between two nodes a mover stands on, so that it never crosses ground a
   * step cannot.
   */
  joined(node: NodeId, next: NodeId): boolean {
    const y = this.yOf(node);
    const dx = this.xOf(next) - this.xOf(node);
    const dy = this.yOf(next) - y;
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      if (dxs[i] === dx && EDGE_DY[i] === dy) return (this.edgeMaskAt(node) & (EDGE_BITS[i] ?? 0)) !== 0;
    }
    return false;
  }

  /** The open ground edge bits of the in-bounds node id `c`, every bit when the map carries no edges. */
  private edgeMaskAt(c: number): number {
    return this.groundEdges === undefined ? ALL_EDGES : (this.groundEdges[c] ?? 0);
  }

  /** Whether the in-bounds node id `c` is open to a land mover (`land`) or a ship and not masked by the
   *  dynamic `blocked` overlay. */
  private open(
    c: number,
    blocked: BlockOverlay | undefined,
    bytes: Uint8Array | undefined,
    land: boolean,
  ): boolean {
    const id = c as NodeId;
    if (!(land ? this.walkableAt(id) : this.isWater(id))) return false;
    if (bytes !== undefined) return bytes[id] !== 1;
    return !(blocked?.has(id) ?? false);
  }
}
