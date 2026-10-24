import { describe, expect, it } from 'vitest';
import { reconcileSprites } from '../../src/gpu/sprite-pool/index.js';

/**
 * An entity that has left the snapshot frees its objects, while one merely culled off-screen is kept for
 * when it scrolls back. Getting this wrong is either a leak or a flicker.
 */

describe('reconcileSprites', () => {
  it('destroys pooled entities absent from the live set, in pool order, and keeps culled-but-live ones', () => {
    const live = new Set([1, 2, 4, 6]); // 6 was never pooled
    const pooled = [5, 1, 2, 3, 4]; // 3 and 5 have left the snapshot
    expect(reconcileSprites(live, pooled).toDestroy).toEqual([5, 3]);
    expect(reconcileSprites(live, [1, 2, 4]).toDestroy).toEqual([]);
  });
});
