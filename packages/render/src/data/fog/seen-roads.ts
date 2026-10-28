import type { RoadChanges } from '../scene/road-shards.js';

/** The road network as the viewer last saw it, for the ground and the minimap to draw alike. */
export interface SeenRoadNetwork {
  /** Bumps whenever {@link nodes} changes. */
  readonly revision: number;
  /** The half-cell node ids (`hy * nodeWidth + hx`) the viewer believes laid. */
  readonly nodes: ReadonlySet<number>;
}

/**
 * The viewer's memory of the road network: a road laid or torn up out of sight changes nothing drawn
 * until the viewer sees its node, as the fog's remembered statics do. The network a game starts with is
 * known at once, like the map's terrain. Render-side and per local viewer, so the sim's determinism is
 * untouched. Work follows the changed and still-unseen nodes, never the whole network.
 */
export class SeenRoads implements SeenRoadNetwork {
  private readonly live = new Set<number>();
  private readonly shown = new Set<number>();
  /** Nodes whose live state differs from the shown one while the viewer does not see them. */
  private readonly waiting = new Set<number>();
  private started = false;
  private restored: readonly number[] | null = null;
  private revisionValue = 0;

  constructor(readonly nodeWidth: number) {}

  get revision(): number {
    return this.revisionValue;
  }

  get nodes(): ReadonlySet<number> {
    return this.shown;
  }

  /** Start from a saved memory instead of the network as it stands; call before the first update. */
  restore(nodes: readonly number[]): void {
    this.restored = nodes;
  }

  /**
   * Take the live network's `changes` and the viewer's sight; answers what the drawn network gains and
   * loses, or null when it holds. `sightMoved` asks for a recheck of the nodes still unseen.
   */
  update(
    changes: RoadChanges | null,
    seesNode: (hx: number, hy: number) => boolean,
    sightMoved: boolean,
  ): RoadChanges | null {
    const added: number[] = [];
    const removed: number[] = [];
    const sync = (node: number): void => {
      const hx = node % this.nodeWidth;
      if (!seesNode(hx, (node - hx) / this.nodeWidth)) {
        this.waiting.add(node);
        return;
      }
      this.waiting.delete(node);
      if (this.live.has(node)) {
        if (!this.shown.has(node)) {
          this.shown.add(node);
          added.push(node);
        }
      } else if (this.shown.delete(node)) removed.push(node);
    };
    if (!this.started) {
      this.started = true;
      for (const node of changes?.added ?? []) this.live.add(node);
      const restored = this.restored;
      this.restored = null;
      for (const node of restored ?? this.live) {
        this.shown.add(node);
        added.push(node);
      }
      if (restored !== null) {
        for (const node of this.live) if (!this.shown.has(node)) sync(node);
        for (const node of this.shown) if (!this.live.has(node)) sync(node);
      }
    } else if (changes !== null) {
      for (const node of changes.removed) this.live.delete(node);
      for (const node of changes.added) this.live.add(node);
      for (const node of changes.removed) sync(node);
      for (const node of changes.added) sync(node);
    }
    if (sightMoved) for (const node of this.waiting) sync(node);
    if (added.length === 0 && removed.length === 0) return null;
    this.revisionValue++;
    return { added, removed };
  }
}
