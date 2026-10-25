import type { Fixed } from '../../core/fixed.js';
import { slantDx } from './edges.js';
import { latticeOffsetFloor } from './lattice-distance.js';

/** The network label of a node no road runs over. */
export const NO_ROAD_NETWORK = -1;

/** A network's bounding box in half-cell coordinates. */
interface NetworkBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The connected road networks of a half-cell grid as a union-find over its road nodes: two road nodes
 * share a network when a chain of road nodes joins them over the pathfinder's steps, the six lattice
 * edges. Roads are only added between rebuilds, so a lay only merges
 * networks. A root is the least node id of its network, so labels are a pure function of the road set;
 * path halving on lookup changes no label.
 */
export class RoadNetworks {
  /** Per node, its parent in the forest, itself at a root, or {@link NO_ROAD_NETWORK} off the roads. */
  private readonly parent: Int32Array;
  /** Per root, its network's bounding box: keyed by root rather than a lane per node, since roads cover
   *  a small share of the map. Lookup only, never iterated. */
  private readonly boxes = new Map<number, NetworkBox>();

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.parent = new Int32Array(width * height).fill(NO_ROAD_NETWORK);
  }

  clear(): void {
    this.parent.fill(NO_ROAD_NETWORK);
    this.boxes.clear();
  }

  /** Put a road on `node` and merge it with the networks of the roads beside it. */
  add(node: number): void {
    if (this.parent[node] !== NO_ROAD_NETWORK) return;
    const { width, height } = this;
    const x = node % width;
    const y = (node - x) / width;
    this.parent[node] = node;
    this.boxes.set(node, { minX: x, maxX: x, minY: y, maxY: y });
    if (x > 0) this.join(node, node - 1);
    if (x < width - 1) this.join(node, node + 1);
    if (y > 0) this.join(node, node - width);
    if (y < height - 1) this.join(node, node + width);
    const slant = slantDx(y);
    if (x + slant >= 0 && x + slant < width) {
      if (y > 0) this.join(node, node - width + slant);
      if (y < height - 1) this.join(node, node + width + slant);
    }
  }

  /** The label of the network `node` belongs to, or {@link NO_ROAD_NETWORK} off the roads. */
  networkOf(node: number): number {
    const { parent } = this;
    let current = node;
    let up = parent[current] ?? NO_ROAD_NETWORK;
    if (up === NO_ROAD_NETWORK) return NO_ROAD_NETWORK;
    while (up !== current) {
      const grand = parent[up] ?? up;
      parent[current] = grand;
      current = grand;
      up = parent[current] ?? current;
    }
    return current;
  }

  /** A lower bound on the lattice distance from `(x, y)` to every road of `network`: the distance to
   *  the nearest point of its bounding box, 0 inside it. */
  gapTo(network: number, x: number, y: number): Fixed {
    const box = this.boxes.get(network);
    const dx = box === undefined ? 0 : Math.max(0, box.minX - x, x - box.maxX);
    const dy = box === undefined ? 0 : Math.max(0, box.minY - y, y - box.maxY);
    return latticeOffsetFloor(dx, dy);
  }

  private join(node: number, neighbour: number): void {
    const other = this.networkOf(neighbour);
    if (other === NO_ROAD_NETWORK) return;
    const own = this.networkOf(node);
    if (own === other) return;
    const root = Math.min(own, other);
    const child = Math.max(own, other);
    this.parent[child] = root;
    const rootBox = this.boxes.get(root);
    const childBox = this.boxes.get(child);
    if (rootBox === undefined || childBox === undefined)
      throw new Error(`road network ${root} or ${child} has no box`);
    rootBox.minX = Math.min(rootBox.minX, childBox.minX);
    rootBox.maxX = Math.max(rootBox.maxX, childBox.maxX);
    rootBox.minY = Math.min(rootBox.minY, childBox.minY);
    rootBox.maxY = Math.max(rootBox.maxY, childBox.maxY);
    this.boxes.delete(child);
  }
}
