import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW, SLANT_STEP } from '../world-metric.js';
import { slantDx } from './edges.js';

/** The share of the map's nodes a wavefront may settle before {@link RoadDistanceField.lower} hands
 *  over to the full rebuild. Measured on a 480 x 380 node map: the rebuild costs about as much as
 *  settling 100k nodes and a lone road settles about 5k, so only a large batch falls back. */
const WAVEFRONT_BUDGET_DIVISOR = 4;

/** The distance a node with no road on the map reads, in columns: past any map's lattice extent, and
 *  as a Fixed still clear of int32 overflow when a step is added to it. */
export const NO_ROAD_DISTANCE: Fixed = fx.fromInt(2 ** 14);

/**
 * The farthest a road reaches in the field, in columns: a node this far or farther from every road reads
 * {@link NO_ROAD_DISTANCE}, so one lay settles at most the nodes within this reach of it. The route
 * heuristic only counts a road nearer than a third of the way to the goal, so the reach trims routes of
 * 48 columns and more. Authored: on magiczny_las routes match an unbounded field from 24 columns up,
 * and at 16 cost 0.3% more between towns.
 */
export const ROAD_DISTANCE_REACH: Fixed = fx.fromInt(16);

/** Slots a wavefront queue starts with; it doubles as a lay outgrows it. */
const INITIAL_QUEUE_CAPACITY = 1024;

/** The last wavefront generation before the Uint16 settle stamps wrap and are cleared. */
const MAX_GENERATION = 0xffff;

/** The nearest road of a node no road reaches. */
export const NO_NEAREST_ROAD = -1;

const NO_NODE = -1;

/**
 * Fill `distances` with each node's obstacle-free lattice distance to the nearest road node, in column
 * units, over a row-major `width` x `height` half-cell grid, and `nearest` with that road node, the least
 * id among equally near ones. It is the route heuristic's lattice metric. Nodes beyond
 * {@link ROAD_DISTANCE_REACH} read {@link NO_ROAD_DISTANCE} and {@link NO_NEAREST_ROAD}. Two raster
 * passes (a chamfer transform) are exact here: a cheapest lattice walk takes straight steps, diagonals
 * and at most one slant, all of one heading each, and only the slant turns the row parity, so it reorders
 * into a forward-pass part (down, or rightward) followed by a backward-pass part (up, or leftward).
 * O(nodes): the rebuild for a restore or a first road; {@link RoadDistanceField.lower} extends the field
 * as roads are laid.
 */
export function fillRoadDistances(
  distances: Int32Array,
  nearest: Int32Array,
  width: number,
  height: number,
  roads: Iterable<number>,
): void {
  distances.fill(NO_ROAD_DISTANCE);
  nearest.fill(NO_NEAREST_ROAD);
  let any = false;
  for (const node of roads) {
    distances[node] = 0;
    nearest[node] = node;
    any = true;
  }
  if (!any) return;
  // Forward pass: each node takes over from its W and N neighbours, both upper diagonals and its slant
  // neighbour in the row above (the edge is symmetric, so that is the node whose slant lands here).
  for (let y = 0; y < height; y++) {
    const slant = slantDx(y);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0) offerRoad(distances, nearest, i, i - 1, HALF_COLUMN);
      if (y > 0) {
        offerRoad(distances, nearest, i, i - width, HALF_ROW);
        const slantX = x + slant;
        if (slantX >= 0 && slantX < width) offerRoad(distances, nearest, i, i - width + slant, SLANT_STEP);
      }
      if (y > 1) {
        const up = i - 2 * width;
        if (x > 0) offerRoad(distances, nearest, i, up - 1, DIAGONAL_STEP);
        if (x < width - 1) offerRoad(distances, nearest, i, up + 1, DIAGONAL_STEP);
      }
      clampToReach(distances, nearest, i);
    }
  }
  // Backward pass: the mirror image, from the E and S neighbours, both lower diagonals and the slant
  // neighbour in the row below.
  for (let y = height - 1; y >= 0; y--) {
    const slant = slantDx(y);
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x < width - 1) offerRoad(distances, nearest, i, i + 1, HALF_COLUMN);
      if (y < height - 1) {
        offerRoad(distances, nearest, i, i + width, HALF_ROW);
        const slantX = x + slant;
        if (slantX >= 0 && slantX < width) offerRoad(distances, nearest, i, i + width + slant, SLANT_STEP);
      }
      if (y < height - 2) {
        const down = i + 2 * width;
        if (x > 0) offerRoad(distances, nearest, i, down - 1, DIAGONAL_STEP);
        if (x < width - 1) offerRoad(distances, nearest, i, down + 1, DIAGONAL_STEP);
      }
      clampToReach(distances, nearest, i);
    }
  }
}

/** Let node `i` take `from`'s nearest road over a step of `length`: {@link takeNearerRoad} with the
 *  reads inlined, for the rebuild's raster passes. */
function offerRoad(
  distances: Int32Array,
  nearest: Int32Array,
  i: number,
  from: number,
  length: number,
): void {
  const distance = (distances[from] ?? NO_ROAD_DISTANCE) + length;
  const known = distances[i] ?? NO_ROAD_DISTANCE;
  if (distance > known) return;
  const road = nearest[from] ?? NO_NEAREST_ROAD;
  if (distance === known && road >= (nearest[i] ?? NO_NEAREST_ROAD)) return;
  distances[i] = distance;
  nearest[i] = road;
}

/** Give node `i` `road` at `distance` when that is nearer than what it holds, or as near with a lower id;
 *  returns whether it did. */
function takeNearerRoad(
  distances: Int32Array,
  nearest: Int32Array,
  i: number,
  distance: number,
  road: number,
): boolean {
  const known = distances[i] ?? NO_ROAD_DISTANCE;
  if (distance > known || (distance === known && road >= (nearest[i] ?? NO_NEAREST_ROAD))) return false;
  distances[i] = distance;
  nearest[i] = road;
  return true;
}

function clampToReach(distances: Int32Array, nearest: Int32Array, i: number): void {
  if ((distances[i] ?? NO_ROAD_DISTANCE) < ROAD_DISTANCE_REACH) return;
  distances[i] = NO_ROAD_DISTANCE;
  nearest[i] = NO_NEAREST_ROAD;
}

/** A FIFO of node ids that grows on demand, so a field holds queue room for its largest lay so far
 *  rather than for the whole settle budget. */
class NodeFifo {
  private items = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private head = 0;
  private tail = 0;

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }

  push(node: number): void {
    if (this.tail === this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    this.items[this.tail++] = node;
  }

  /** The first queued node the wavefront `generation` has not settled, dropping the settled ones before
   *  it, or {@link NO_NODE} once drained. */
  firstUnsettled(settledIn: Uint16Array, generation: number): number {
    while (this.head < this.tail) {
      const node = this.items[this.head] ?? NO_NODE;
      if (settledIn[node] !== generation) return node;
      this.head++;
    }
    return NO_NODE;
  }
}

/**
 * A map's road distance and nearest-road lanes with the scratch their incremental update reuses. Laying
 * roads only lowers distances, so {@link lower} runs a Dijkstra out of the new nodes over the chamfer
 * passes' own edge set and stops where no node improves. The lattice has four edge lengths, so the open
 * set is one FIFO per length: a settled node's steps of one length join that length's queue in settle
 * order, which keeps each queue sorted, and the least of the four heads settles next. Each node settles
 * once, so a lay costs the nodes it brings nearer to a road (or to a lower-id road as near), and the
 * result is what a full rebuild computes, whatever the batching. A wavefront that outgrows its budget
 * finishes as a full rebuild instead, with the same result.
 */
export class RoadDistanceField {
  readonly distances: Int32Array;
  /** Per node, its nearest road node, or {@link NO_NEAREST_ROAD}. */
  readonly nearest: Int32Array;
  /** Settles one lay may take before the rebuild takes over. */
  private readonly budget: number;
  /** Per edge length, the nodes a step of that length improved; the row queue also leads with the new
   *  roads. A node may sit in several; entries after its first settle are skipped. */
  private readonly rowQueue = new NodeFifo();
  private readonly columnQueue = new NodeFifo();
  private readonly slantQueue = new NodeFifo();
  private readonly diagonalQueue = new NodeFifo();
  private readonly queues: readonly NodeFifo[] = [
    this.rowQueue,
    this.columnQueue,
    this.slantQueue,
    this.diagonalQueue,
  ];
  /** The {@link generation} of the wavefront that settled each node. */
  private readonly settledIn: Uint16Array;
  private generation = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const nodeCount = width * height;
    this.budget = Math.floor(nodeCount / WAVEFRONT_BUDGET_DIVISOR);
    this.distances = new Int32Array(nodeCount);
    this.nearest = new Int32Array(nodeCount);
    this.settledIn = new Uint16Array(nodeCount);
  }

  rebuild(roads: Iterable<number>): void {
    fillRoadDistances(this.distances, this.nearest, this.width, this.height, roads);
  }

  /** Lower the field for `added` road nodes on top of the roads it already holds; `roads` is the whole
   *  network, `added` included, for the rebuild an outgrown wavefront falls back to. */
  lower(added: Iterable<number>, roads: Iterable<number>): void {
    const { distances, nearest, rowQueue, columnQueue, slantQueue, diagonalQueue, settledIn, width, height } =
      this;
    if (this.generation === MAX_GENERATION) {
      settledIn.fill(0);
      this.generation = 0;
    }
    const generation = ++this.generation;
    for (const queue of this.queues) queue.reset();
    // A road reads 0, under any step, so the new ones lead the row queue.
    for (const node of added) {
      if (takeNearerRoad(distances, nearest, node, 0, node)) rowQueue.push(node);
    }
    for (let settles = 0; ; settles++) {
      let node = NO_NODE;
      let nodeDistance: number = NO_ROAD_DISTANCE;
      for (const queue of this.queues) {
        const candidate = queue.firstUnsettled(settledIn, generation);
        if (candidate === NO_NODE) continue;
        const distance = distances[candidate] ?? NO_ROAD_DISTANCE;
        if (node === NO_NODE || distance < nodeDistance) {
          node = candidate;
          nodeDistance = distance;
        }
      }
      if (node === NO_NODE) return;
      if (settles === this.budget) {
        this.rebuild(roads);
        return;
      }
      // The winning head is the node itself; its stamp skips it at the next scan.
      settledIn[node] = generation;
      const road = nearest[node] ?? NO_NEAREST_ROAD;
      const x = node % width;
      const y = (node - x) / width;
      const byRow = nodeDistance + HALF_ROW;
      const byColumn = nodeDistance + HALF_COLUMN;
      const bySlant = nodeDistance + SLANT_STEP;
      const byDiagonal = nodeDistance + DIAGONAL_STEP;
      // Steps past the reach take nothing; the lengths grow row, column, slant, diagonal.
      if (byRow >= ROAD_DISTANCE_REACH) continue;
      if (y > 0 && takeNearerRoad(distances, nearest, node - width, byRow, road)) rowQueue.push(node - width);
      if (y < height - 1 && takeNearerRoad(distances, nearest, node + width, byRow, road)) {
        rowQueue.push(node + width);
      }
      if (byColumn >= ROAD_DISTANCE_REACH) continue;
      if (x > 0 && takeNearerRoad(distances, nearest, node - 1, byColumn, road)) columnQueue.push(node - 1);
      if (x < width - 1 && takeNearerRoad(distances, nearest, node + 1, byColumn, road)) {
        columnQueue.push(node + 1);
      }
      if (bySlant >= ROAD_DISTANCE_REACH) continue;
      const slant = slantDx(y);
      if (x + slant >= 0 && x + slant < width) {
        if (y > 0 && takeNearerRoad(distances, nearest, node - width + slant, bySlant, road)) {
          slantQueue.push(node - width + slant);
        }
        if (y < height - 1 && takeNearerRoad(distances, nearest, node + width + slant, bySlant, road)) {
          slantQueue.push(node + width + slant);
        }
      }
      if (byDiagonal >= ROAD_DISTANCE_REACH) continue;
      if (y > 1) {
        const up = node - 2 * width;
        if (x > 0 && takeNearerRoad(distances, nearest, up - 1, byDiagonal, road)) diagonalQueue.push(up - 1);
        if (x < width - 1 && takeNearerRoad(distances, nearest, up + 1, byDiagonal, road)) {
          diagonalQueue.push(up + 1);
        }
      }
      if (y < height - 2) {
        const down = node + 2 * width;
        if (x > 0 && takeNearerRoad(distances, nearest, down - 1, byDiagonal, road)) {
          diagonalQueue.push(down - 1);
        }
        if (x < width - 1 && takeNearerRoad(distances, nearest, down + 1, byDiagonal, road)) {
          diagonalQueue.push(down + 1);
        }
      }
    }
  }
}
