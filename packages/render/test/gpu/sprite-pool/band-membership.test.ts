import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { Camera, Viewport } from '../../../src/data/projection/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import {
  BAND_DEPTH,
  DepthSortedLayer,
  drawLayerOf,
} from '../../../src/gpu/world-renderer/depth-sorted-layer.js';
import type { SpriteAtlas, SpriteSheet } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

/** A pooled entity lives in a depth band of the sprite layer; a full pass must not re-add it there,
 *  which would rebuild its band's instructions on every tick. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = new TextureSource({ width: 64, height: 64 });
const BODY_BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: BODY_BOB, building: BODY_BOB, resource: BODY_BOB },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BODY_BOB } } },
};
const SETTLER = 1;
const FAR_TILE = 40;

const settlerAt = (ref: number, tileX: number, tileY: number) =>
  entity(ref, tileX, tileY, { Settler: { tribe: 0 } });

function frameOf(tick: number, settlers: ReturnType<typeof settlerAt>[]): PoolFrame {
  return {
    snapshot: snapshotOf(settlers, tick),
    viewport: VIEW_ALL,
    tick,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  };
}

function frameAt(tick: number, tileX: number, tileY = 0): PoolFrame {
  return frameOf(tick, [settlerAt(SETTLER, tileX, tileY)]);
}

/** The index of the depth band `child` sits in. */
function bandIndexOf(child: Container): number | undefined {
  return (child.parent as (Container & { index?: number }) | null)?.index;
}

function setup() {
  const layer = new DepthSortedLayer();
  layer.isRenderGroup = true;
  const pool = new SpritePool(layer, new TextureCache(), sheet);
  const addChild = vi.spyOn(layer, 'addChild');
  return { layer, pool, addChild };
}

describe('SpritePool - band membership', () => {
  it('names the depth-sorted layer as the draw layer of a child in one of its bands', () => {
    const layer = new DepthSortedLayer();
    const child = layer.addChild(new Container());
    expect(child.parent).not.toBe(layer);
    expect(drawLayerOf(child)).toBe(layer);
    const plain = new Container();
    const loose = plain.addChild(new Container());
    expect(drawLayerOf(loose)).toBe(plain);
  });

  it('adds an entity to its layer once across full passes on new ticks', () => {
    const { pool, addChild } = setup();
    pool.reconcile(frameAt(1, 0));
    pool.reconcile(frameAt(2, 0));
    pool.reconcile(frameAt(3, 0));
    expect(addChild).toHaveBeenCalledTimes(1);
  });

  it('moves an entity into the band of its new depth without re-adding it', () => {
    const { layer, pool, addChild } = setup();
    pool.reconcile(frameAt(1, 0));
    const [child] = layer.entries();
    if (child === undefined) throw new Error('the settler was not drawn');
    const before = bandIndexOf(child);
    pool.reconcile(frameAt(2, 0, FAR_TILE));
    layer.sortChildren();
    expect(addChild).toHaveBeenCalledTimes(1);
    expect(layer.entries()).toEqual([child]);
    expect(bandIndexOf(child)).toBe(Math.floor(child.zIndex / BAND_DEPTH));
    expect(bandIndexOf(child)).not.toBe(before);
  });

  it('paints entities that come to share one depth in the order the pass visits them', () => {
    const { layer, pool } = setup();
    const FRONT = 1;
    const BACK = 2;
    // The front settler stands a tile right of the other, which its x tiebreak paints over.
    pool.reconcile(frameOf(1, [settlerAt(FRONT, 1, 0), settlerAt(BACK, 0, 0)]));
    layer.sortChildren();
    const [back, front] = layer.entries();
    if (back === undefined || front === undefined) throw new Error('both settlers should draw');
    expect(bandIndexOf(back)).toBe(bandIndexOf(front));
    expect(front.zIndex).toBeGreaterThan(back.zIndex);
    // It steps onto the other's node: the draw list then visits it first, by its lower ref.
    pool.reconcile(frameOf(2, [settlerAt(FRONT, 0, 0), settlerAt(BACK, 0, 0)]));
    layer.sortChildren();
    expect(front.zIndex).toBe(back.zIndex);
    expect(layer.entries()).toEqual([front, back]);
  });

  it('adds an entity again after a pass left it off the draw list', () => {
    const { pool, addChild } = setup();
    pool.reconcile(frameAt(1, 0));
    pool.reconcile({ ...frameAt(2, 0), viewport: { minX: 1e9, maxX: 1e9 + 1, minY: 1e9, maxY: 1e9 + 1 } });
    pool.reconcile(frameAt(3, 0));
    expect(addChild).toHaveBeenCalledTimes(2);
  });
});
