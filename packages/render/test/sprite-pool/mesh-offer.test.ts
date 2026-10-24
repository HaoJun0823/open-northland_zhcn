import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { createPooled, meshablePooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { TextureCache } from '../../src/gpu/textures/texture-cache.js';
import type { SpriteAtlas, SpriteSheet, Viewport } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** Which pooled entities the sprite layer draws from its retained mesh. */

const palette = { source: new TextureSource({ width: 256, height: 4 }), colours: 4 };
const source = new TextureSource({ width: 32, height: 32 });
const BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas,
  bindings: { settler: BOB, resource: BOB, building: BOB },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BOB } } },
};
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };

function attached(...args: Parameters<typeof createPooled>): ReturnType<typeof createPooled> {
  const pe = createPooled(...args);
  pe.attached = true;
  return pe;
}

describe('the mesh offer', () => {
  it('takes every attached entity but a vehicle drawing paletted meshes', () => {
    expect(meshablePooled(attached('settler', palette))).toBe(true);
    expect(meshablePooled(attached('settler', undefined))).toBe(true);
    expect(meshablePooled(attached('vehicle', undefined))).toBe(true);
    expect(meshablePooled(attached('building', undefined))).toBe(true);
    expect(meshablePooled(attached('vehicle', palette))).toBe(false);
    expect(meshablePooled(createPooled('settler', undefined))).toBe(false);
  });

  it('answers for the pool’s own containers only', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile({
      snapshot: snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })]),
      viewport: VIEW_ALL,
      tick: 0,
      camera: { offsetX: 0, offsetY: 0 },
      screenW: 800,
      screenH: 600,
      elevation: FLAT,
      alpha: 1,
    });
    const [settler] = layer.children;
    if (settler === undefined) throw new Error('expected the settler drawn');
    expect(pool.meshable(settler)).toBe(true);
    expect(pool.meshable(new Container())).toBe(false);
  });
});
