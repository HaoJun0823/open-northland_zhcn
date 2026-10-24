import { Container, Texture } from 'pixi.js';
import { expect, it } from 'vitest';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/textures/texture-cache.js';
import type { SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

it('keeps worked clay below buildings and detaches culled or depleted deposits', () => {
  const sheet: SpriteSheet = {
    source: Texture.WHITE.source,
    atlas: { width: 1, height: 1, frames: new Map() },
    bindings: {
      settler: 0,
      building: 0,
      resource: {
        default: 0,
        byGood: { 1: [0] },
        flatByGood: { 1: true },
        byGfxIndex: { 9: [0] },
      },
    },
  };
  const layer = new Container();
  const cache = new TextureCache();
  const pool = new SpritePool(layer, cache, sheet);
  const clay = entity(1, 5, 8, { Resource: { goodType: 1, remaining: 5 } });
  const house = entity(2, 5, 6, { Building: {} });
  const rock = entity(3, 5, 8, { Resource: { goodType: 1, remaining: 5, gfxIndex: 9 } });
  const frame: PoolFrame = {
    snapshot: snapshotOf([clay, house, rock]),
    viewport: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
    tick: 0,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 },
    alpha: 1,
  };
  pool.reconcile(frame);
  expect(pool.groundContainer.children).toHaveLength(1);
  expect(layer.children).toHaveLength(2);
  pool.reconcile({ ...frame, viewport: { minX: 1e6, minY: 1e6, maxX: 1e6 + 1, maxY: 1e6 + 1 } });
  expect(pool.groundContainer.children).toHaveLength(0);
  pool.reconcile(frame);
  expect(pool.groundContainer.children).toHaveLength(1);
  pool.reconcile({ ...frame, snapshot: snapshotOf([house, rock], 1), tick: 1 });
  expect(pool.groundContainer.children).toHaveLength(0);
  expect(layer.children).toHaveLength(2);
  pool.destroy();
  cache.clear();
});
