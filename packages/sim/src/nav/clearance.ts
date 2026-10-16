import { HEX_DX_EVEN, HEX_DX_ODD, HEX_DY } from './range-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * The largest free-size class a node can hold. The original stores the class in 3 bits beside the
 * node's blocked bit; how it computes the class is open, and Open Northland's reading is the
 * hex-disc radius below (docs/formats/VEHICLES.md "Movement").
 */
export const MAX_CLEARANCE_CLASS = 7;

/** Whether a node counts as open ground for the clearance: land a settler walks or water a ship sails,
 *  neither walk-blocked. Land and water never share a component, so each side hems the other. */
export type ClearanceProbe = (node: NodeId) => boolean;

/** The class of a node no open node hemmed in within the cap, and of a node that is not open itself. */
const UNREACHED = -1;

/** How far a change reaches in the result: a node's class depends on the points this close to it. */
const REWRITE_RADIUS = MAX_CLEARANCE_CLASS + 1;
/** How far a change reaches in the scan: the rewritten disc's radius again beyond it. */
const SCAN_RADIUS = 2 * REWRITE_RADIUS;
/** Disc stamps are Uint16; on the wrap the stamps clear so no stale slot matches a reused generation. */
const MAX_DISC_GENERATION = 0xffff;
/** Map points in a hexagon disc of the scan radius: `1 + 3 r (r + 1)`. */
const SCAN_DISC_NODES = 1 + 3 * SCAN_RADIUS * (SCAN_RADIUS + 1);
/** Queue and disc slots a field starts with. */
const INITIAL_QUEUE_CAPACITY = 1024;
/** Slots a queue or disc may keep after a pass; a larger one, as a whole-map pass grows, is dropped so it
 *  does not pin a map-sized buffer. */
const MAX_RETAINED_CAPACITY = 1 << 16;

const NEIGHBOURS = HEX_DY.length;

function neighbourDxOf(y: number): readonly number[] {
  return (y & 1) !== 0 ? HEX_DX_ODD : HEX_DX_EVEN;
}

/** `buffer` with room for one more entry past `used`, doubled when full. */
function withRoom(buffer: Int32Array, used: number): Int32Array {
  if (used < buffer.length) return buffer;
  const grown = new Int32Array(buffer.length * 2);
  grown.set(buffer);
  return grown;
}

/**
 * Per-node free-size classes over a terrain graph: a node's class is the largest hexagon-disc radius
 * around it whose every map point is in bounds, open (`probe`) and in the node's own static
 * component, capped at {@link MAX_CLEARANCE_CLASS}. A vehicle of `logicSize` s may stand on a node
 * whose class is at least s, and a ship sails only such nodes; one field serves land and sea, since a
 * water node's disc holds only water of its own body. A node that is not open reads 0.
 *
 * Computed as a multi-source breadth-first distance over the six map-point neighbours: an open node
 * with a hemming neighbour (off the map, not open, or of another component) is at distance 0, and the
 * distance grows by one per ring inward. A hemming point at hexagon distance d from a node puts an open
 * node of distance d-1 on the shortest walk toward it, so the breadth-first distance is exactly the
 * disc radius. {@link recompute} over a region redoes only that region: a node's class depends on the
 * points within `MAX_CLEARANCE_CLASS + 1` of it, so a change at a point reaches twice that far in the
 * scan and once that far in the result.
 */
export class ClearanceField {
  private readonly classes: Uint8Array;
  /** Breadth-first distance, -1 to {@link MAX_CLEARANCE_CLASS}. */
  private readonly distance: Int8Array;
  /** The breadth-first queue, its first {@link queued} slots live; doubles when full. */
  private queue: Int32Array = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private queued = 0;
  /** The last local recompute's scan disc, its first {@link discSize} slots: its nodes, each stamped with
   *  the generation and its map-point depth from the nearest change, so membership and the rewrite cut
   *  are array reads. */
  private disc: Int32Array = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private discSize = 0;
  private readonly discStamps: Uint16Array;
  private readonly discDepths: Uint8Array;
  private discGeneration = 0;
  /** Per class `k`, how many times a water node's class crossed `k`: went from below it to at least it,
   *  or back. */
  private readonly waterCrossings = new Uint32Array(MAX_CLEARANCE_CLASS + 1);

  constructor(
    private readonly graph: TerrainGraph,
    probe: ClearanceProbe,
  ) {
    this.classes = new Uint8Array(graph.nodeCount);
    this.distance = new Int8Array(graph.nodeCount);
    this.discStamps = new Uint16Array(graph.nodeCount);
    this.discDepths = new Uint8Array(graph.nodeCount);
    this.recompute(probe, null);
  }

  classOf(node: NodeId): number {
    const value = this.classes[node];
    if (value === undefined) throw new Error(`node id ${node} out of range (0..${this.graph.nodeCount - 1})`);
    return value;
  }

  /** Changes whenever a water node's class crosses `logicSize`, which is all a hull of that size reads
   *  of it, and never for land, where blockers come and go all game: a cache over the sea outlives every
   *  edit on shore and every narrowing too slight to matter. */
  waterRevision(logicSize: number): number {
    return this.waterCrossings[logicSize] ?? 0;
  }

  /**
   * Recompute the classes of every node within `MAX_CLEARANCE_CLASS + 1` of `changed`, or of the whole
   * map for null. The scan region reaches twice as far so every hemming point that can decide a
   * rewritten class is inside it; the breadth-first walk stays inside the scan region, which is
   * exact because a shortest walk of length at most the cap from a rewritten node never leaves it.
   */
  recompute(probe: ClearanceProbe, changed: ReadonlySet<NodeId> | null): void {
    const { graph } = this;
    const distance = this.distance;
    // Past the point where the changes' scan discs outnumber the map, one full pass is the cheaper scan.
    const local = changed !== null && changed.size * SCAN_DISC_NODES < graph.nodeCount;
    if (local) this.markDisc(changed);
    const { disc, discStamps, discDepths } = this;
    const discSize = this.discSize;
    const scanned = this.discGeneration;

    this.queued = 0;
    if (local) {
      for (let i = 0; i < discSize; i++) this.seed((disc[i] ?? 0) as NodeId, probe);
    } else {
      for (let node = 0 as NodeId; node < graph.nodeCount; node++) this.seed(node, probe);
    }
    // Seeds and discoveries append behind the cursor, so the walk is breadth-first.
    for (let at = 0; at < this.queued; at++) {
      // The queue is read through `this`: an enqueue may replace it with a larger one.
      const current = (this.queue[at] ?? 0) as NodeId;
      const next = (distance[current] ?? 0) + 1;
      if (next > MAX_CLEARANCE_CLASS) continue;
      const x = graph.xOf(current);
      const y = graph.yOf(current);
      const component = graph.componentOf(current);
      const dxs = neighbourDxOf(y);
      for (let i = 0; i < NEIGHBOURS; i++) {
        const nx = x + (dxs[i] ?? 0);
        const ny = y + (HEX_DY[i] ?? 0);
        if (!graph.inBounds(nx, ny)) continue;
        const neighbour = graph.nodeAt(nx, ny);
        if ((local && discStamps[neighbour] !== scanned) || distance[neighbour] !== UNREACHED) continue;
        if (!probe(neighbour) || graph.componentOf(neighbour) !== component) continue;
        distance[neighbour] = next;
        this.enqueue(neighbour);
      }
    }
    if (local) {
      for (let i = 0; i < discSize; i++) {
        const node = (disc[i] ?? 0) as NodeId;
        if ((discDepths[node] ?? SCAN_RADIUS) <= REWRITE_RADIUS) this.write(node, probe);
      }
    } else {
      for (let node = 0 as NodeId; node < graph.nodeCount; node++) this.write(node, probe);
    }
    if (this.queue.length > MAX_RETAINED_CAPACITY) this.queue = new Int32Array(INITIAL_QUEUE_CAPACITY);
    if (this.disc.length > MAX_RETAINED_CAPACITY) this.disc = new Int32Array(INITIAL_QUEUE_CAPACITY);
  }

  /** Start `node`'s breadth-first distance: 0 and queued for an open node a hemming point touches. */
  private seed(node: NodeId, probe: ClearanceProbe): void {
    const hemmed = probe(node) && this.hemmed(node, probe);
    this.distance[node] = hemmed ? 0 : UNREACHED;
    if (hemmed) this.enqueue(node);
  }

  private enqueue(node: NodeId): void {
    this.queue = withRoom(this.queue, this.queued);
    this.queue[this.queued++] = node;
  }

  /** Store `node`'s settled class, counting the water class crossings it makes. */
  private write(node: NodeId, probe: ClearanceProbe): void {
    const d = this.distance[node] ?? UNREACHED;
    const value = !probe(node) ? 0 : d === UNREACHED ? MAX_CLEARANCE_CLASS : d;
    const held = this.classes[node] ?? 0;
    if (held === value) return;
    this.classes[node] = value;
    if (!this.graph.isWater(node)) return;
    for (let k = Math.min(held, value) + 1; k <= Math.max(held, value); k++) {
      this.waterCrossings[k] = (this.waterCrossings[k] ?? 0) + 1;
    }
  }

  /** Whether an open node touches a hemming map point: off the map, not open, or of another component. */
  private hemmed(node: NodeId, probe: ClearanceProbe): boolean {
    const { graph } = this;
    const x = graph.xOf(node);
    const y = graph.yOf(node);
    const component = graph.componentOf(node);
    const dxs = neighbourDxOf(y);
    for (let i = 0; i < NEIGHBOURS; i++) {
      const nx = x + (dxs[i] ?? 0);
      const ny = y + (HEX_DY[i] ?? 0);
      if (!graph.inBounds(nx, ny)) return true;
      const neighbour = graph.nodeAt(nx, ny);
      if (!probe(neighbour) || graph.componentOf(neighbour) !== component) return true;
    }
    return false;
  }

  /**
   * Stamp the in-bounds nodes within {@link SCAN_RADIUS} map-point steps of any of `centres` into
   * {@link disc}, each with its depth from the nearest centre: one breadth-first flood from all centres
   * over the six neighbours, ignoring passability, so a disc rather than a region. Its depths are each
   * node's least distance to a centre, so the nodes within any radius are the union of the per-centre
   * discs of that radius.
   */
  private markDisc(centres: ReadonlySet<NodeId>): void {
    const { graph, discStamps, discDepths } = this;
    if (this.discGeneration >= MAX_DISC_GENERATION) {
      discStamps.fill(0);
      this.discGeneration = 0;
    }
    this.discGeneration += 1;
    const generation = this.discGeneration;
    // A set is already distinct, so every centre takes a slot; `forEach` walks it without an iterator result
    // per entry.
    let size = 0;
    centres.forEach((centre) => {
      discStamps[centre] = generation;
      discDepths[centre] = 0;
      this.disc = withRoom(this.disc, size);
      this.disc[size++] = centre;
    });
    // Discoveries append behind the cursor, so `disc` is its own breadth-first queue.
    for (let at = 0; at < size; at++) {
      const current = (this.disc[at] ?? 0) as NodeId;
      const d = discDepths[current] ?? SCAN_RADIUS;
      if (d >= SCAN_RADIUS) continue;
      const x = graph.xOf(current);
      const y = graph.yOf(current);
      const dxs = neighbourDxOf(y);
      for (let i = 0; i < NEIGHBOURS; i++) {
        const nx = x + (dxs[i] ?? 0);
        const ny = y + (HEX_DY[i] ?? 0);
        if (!graph.inBounds(nx, ny)) continue;
        const neighbour = graph.nodeAt(nx, ny);
        if (discStamps[neighbour] === generation) continue;
        discStamps[neighbour] = generation;
        discDepths[neighbour] = d + 1;
        this.disc = withRoom(this.disc, size);
        this.disc[size++] = neighbour;
      }
    }
    this.discSize = size;
  }
}
