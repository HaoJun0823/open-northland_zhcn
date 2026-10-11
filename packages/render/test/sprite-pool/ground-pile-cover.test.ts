import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { drawPassDepth } from '../../src/data/scene/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const COVER = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
const FRAME: PoolFrame = {
  snapshot: snapshotOf([
    entity(1, 0, 0, { Stockpile: { amounts: [[1, 4]] } }),
    entity(2, 8, 8, { Stockpile: { amounts: [[1, 4]] } }),
    entity(3, 0, 0, { Stockpile: { amounts: [] }, DeliveryFlag: { worker: null } }),
    entity(4, 0, 0, { Settler: { tribe: 0 } }),
  ]),
  viewport: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  tick: 0,
  camera: { offsetX: 0, offsetY: 0 },
  screenW: 800,
  screenH: 600,
  elevation: { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 },
  alpha: 1,
};

describe('salvage underneath a building collapse', () => {
  it('puts only overlapping heaps under the body and dust, and restores held sprites when cover ends', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(FRAME);
    const nodes = [...layer.children];
    const normal = nodes.map((node) => node.zIndex);
    const items = pool.drawnItems();
    const pileIndex = items.findIndex((item) => item.ref === 1);
    expect(pileIndex).toBeGreaterThanOrEqual(0);
    expect(items.find((item) => item.ref === 3)?.isFlag).toBe(true);
    pool.coverGroundPiles([COVER]);
    for (let i = 0; i < nodes.length; i++) {
      expect(nodes[i]?.zIndex).toBe((normal[i] ?? 0) + (i === pileIndex ? drawPassDepth('ground') : 0));
    }
    // A paused frame reuses its scene and sprite binds; the cover must neither accumulate nor vanish.
    pool.reconcile(FRAME);
    pool.coverGroundPiles([COVER, COVER]);
    expect(nodes[pileIndex]?.zIndex).toBe((normal[pileIndex] ?? 0) + drawPassDepth('ground'));
    pool.reconcile(FRAME);
    pool.coverGroundPiles([]);
    expect(nodes.map((node) => node.zIndex)).toEqual(normal);
    pool.destroy();
  });

  it('releases covered heaps when they leave the view or are collected', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    pool.reconcile(FRAME);
    pool.coverGroundPiles([COVER]);
    pool.reconcile({ ...FRAME, viewport: { minX: 500, minY: 500, maxX: 600, maxY: 600 } });
    pool.coverGroundPiles([COVER]);
    expect(layer.children).toHaveLength(0);
    pool.reconcile(FRAME);
    pool.coverGroundPiles([COVER]);
    pool.reconcile({ ...FRAME, snapshot: snapshotOf([]) });
    expect(() => pool.coverGroundPiles([])).not.toThrow();
    expect(layer.children).toHaveLength(0);
    pool.destroy();
  });
});
