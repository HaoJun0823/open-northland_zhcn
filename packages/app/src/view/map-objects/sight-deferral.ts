/** The viewer's sight, as the static layer asks it: fog off sees every node. */
export interface SightGate {
  /** Whether the viewer currently watches the cell of half-cell node (hx, hy). */
  seesNode(hx: number, hy: number): boolean;
  /** Bumps whenever {@link seesNode} may answer differently. */
  revision(): number;
}

interface PendingChange {
  readonly hx: number;
  readonly hy: number;
  readonly apply: () => void;
}

/**
 * A change to the map's static quads that waits until the viewer sees it: a tree felled, a deposit
 * mined out or scenery cleared under a wall in the fog keeps its last-seen quad until the player looks
 * again, as the fog's remembered statics do. One change per placement; a later one replaces it.
 */
export class SightDeferral {
  private readonly pending = new Map<number, PendingChange>();
  private flushedAt: number | null = null;

  constructor(private readonly gate: SightGate) {}

  /** Apply `apply` now when the viewer sees (hx, hy), else on the first {@link flush} that does. */
  defer(placement: number, hx: number, hy: number, apply: () => void): void {
    if (this.gate.seesNode(hx, hy)) {
      this.pending.delete(placement);
      apply();
    } else this.pending.set(placement, { hx, hy, apply });
  }

  /** Apply the waiting changes the viewer now sees; a frame whose sight did not change costs a compare. */
  flush(): void {
    const revision = this.gate.revision();
    if (revision === this.flushedAt || this.pending.size === 0) {
      this.flushedAt = revision;
      return;
    }
    this.flushedAt = revision;
    for (const [placement, change] of this.pending) {
      if (!this.gate.seesNode(change.hx, change.hy)) continue;
      this.pending.delete(placement);
      change.apply();
    }
  }

  /** The placements whose change still waits. */
  waiting(): IterableIterator<number> {
    return this.pending.keys();
  }
}
