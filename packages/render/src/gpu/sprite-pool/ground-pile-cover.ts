import type { Viewport } from '../../data/projection/index.js';
import { type DrawItem, drawPassDepth, screenDepth } from '../../data/scene/index.js';
import type { PooledEntity } from './pooled-entity.js';

/** Temporary ground-pass membership: falling bodies and dust uncover heaps through their alpha.
 * Only the culled draw list is visited, and cover boxes are capped by MAX_ACTIVE_COLLAPSES. */
export class GroundPileCover {
  private readonly covered = new Map<PooledEntity, number>();
  private readonly seen = new Set<PooledEntity>();

  apply(
    items: readonly DrawItem[],
    pool: ReadonlyMap<number, PooledEntity>,
    covers: readonly Viewport[],
  ): void {
    if (covers.length === 0 && this.covered.size === 0) return;
    this.seen.clear();
    if (covers.length > 0) {
      for (const item of items) {
        if (item.kind !== 'stockpile' || item.isFlag === true) continue;
        const pe = pool.get(item.ref);
        if (pe === undefined || !pe.attached) continue;
        if (!coveredBy(pe.bounds, covers)) continue;
        const depth = screenDepth(pe.motion.drawX, pe.motion.drawY + (item.lift ?? 0), 'stockpile');
        this.covered.set(pe, depth);
        this.seen.add(pe);
        pe.container.zIndex = depth + drawPassDepth('ground');
      }
    }
    for (const [pe, depth] of this.covered) {
      if (this.seen.has(pe)) continue;
      if (!pe.container.destroyed) pe.container.zIndex = depth;
      this.covered.delete(pe);
    }
  }

  clear(): void {
    this.covered.clear();
    this.seen.clear();
  }
}

function coveredBy(bounds: Viewport, covers: readonly Viewport[]): boolean {
  for (const c of covers) {
    if (bounds.minX <= c.maxX && bounds.maxX >= c.minX && bounds.minY <= c.maxY && bounds.maxY >= c.minY)
      return true;
  }
  return false;
}
