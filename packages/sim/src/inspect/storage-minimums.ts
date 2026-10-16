import { isPlainRecord } from '../core/plain-value.js';
import type { WorldSnapshot } from './snapshot.js';
import { entitiesWith } from './snapshot-indexes.js';

const NO_MINIMUMS: ReadonlyMap<number, number> = new Map();

/** Decode one player's storage minimums, good type -> units: the lowest-id well-formed carrier of
 *  `player` decides, and an absent one keeps none. The snapshot carries the map as `[good, units]` pairs. */
export function storageMinimumsView(snapshot: WorldSnapshot, player: number): ReadonlyMap<number, number> {
  for (const entity of entitiesWith(snapshot, 'StorageMinimums')) {
    const raw = entity.components.StorageMinimums;
    if (!isPlainRecord(raw) || raw.player !== player || !Array.isArray(raw.minimums)) continue;
    const minimums = new Map<number, number>();
    for (const pair of raw.minimums) {
      if (!Array.isArray(pair)) continue;
      const [good, units] = pair;
      if (typeof good === 'number' && typeof units === 'number') minimums.set(good, units);
    }
    return minimums;
  }
  return NO_MINIMUMS;
}
