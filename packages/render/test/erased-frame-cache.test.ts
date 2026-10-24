import { type Sprite, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { LayerBinder } from '../src/gpu/sprite-pool/bind-layers.js';
import { createPooled } from '../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../src/gpu/sprite-pool/resolved-layer.js';
import * as drawable from '../src/gpu/textures/drawable-resource.js';
import { ErasedFrameCache, type ErasedRegion } from '../src/gpu/textures/erased-frame-cache.js';
import { TextureCache } from '../src/gpu/textures/texture-cache.js';

afterEach(() => vi.restoreAllMocks());

const FRAME: AtlasFrame = { x: 20, y: 30, width: 10, height: 12, offsetX: -5, offsetY: -9 };
/** The frame's top-right corner, overhanging it on two sides. */
const CORNER: ErasedRegion = [{ minX: 2, minY: -20, maxX: 9, maxY: -6 }];
const MISSES: ErasedRegion = [{ minX: 20, minY: -9, maxX: 30, maxY: 3 }];

function mockCanvas(): { drawImage: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({ canvas: { width, height }, drawImage, clearRect }) as unknown as CanvasRenderingContext2D,
  );
  return { drawImage, clearRect };
}

describe('erased frames', () => {
  it('copies the frame and clears the region, clipped to it, in frame px', () => {
    const { drawImage, clearRect } = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    const bake = new ErasedFrameCache().get(page, FRAME, CORNER, { scale: 1 });
    expect(drawImage).toHaveBeenCalledWith(page.resource, 20, 30, 10, 12, 0, 0, 10, 12);
    expect(clearRect).toHaveBeenCalledWith(7, 0, 3, 3);
    expect(bake?.frame).toEqual({ ...FRAME, x: 0, y: 0 });
    expect(bake?.source).not.toBe(page);
  });

  it('places the region through the layer offset and scale', () => {
    const { clearRect } = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    new ErasedFrameCache().get(page, FRAME, CORNER, { scale: 2, dx: 4, dy: -2 });
    expect(clearRect).toHaveBeenCalledWith(4, 0, 4, 7);
  });

  it('bakes nothing for a region that misses the frame', () => {
    const { drawImage } = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    expect(new ErasedFrameCache().get(page, FRAME, MISSES, { scale: 1 })).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('bakes each frame and region once', () => {
    const { drawImage } = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    const cache = new ErasedFrameCache();
    const bake = cache.get(page, FRAME, CORNER, { scale: 1 });
    expect(cache.get(page, FRAME, CORNER, { scale: 1 })).toBe(bake);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('samples like its atlas page after the page flips', () => {
    mockCanvas();
    const page = new TextureSource({ width: 64, height: 64, scaleMode: 'linear' });
    const cache = new ErasedFrameCache();
    expect(cache.get(page, FRAME, CORNER, { scale: 1 })?.source.scaleMode).toBe('linear');
    page.scaleMode = 'nearest';
    expect(cache.get(page, FRAME, CORNER, { scale: 1 })?.source.scaleMode).toBe('nearest');
  });

  it('binds a building flagged in the frame from its erased copy, and from the atlas once unflagged', () => {
    mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    const textures = new TextureCache();
    const binder = new LayerBinder(textures, undefined);
    const pe = createPooled('building', undefined);
    const item: DrawItem = { ref: 1, kind: 'building', x: 0, y: 0, depth: 0 };
    const body: ResolvedLayer = { source: page, frame: FRAME, scale: 1 };
    const frame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
    binder.bind(pe, item, [body], { ...frame, erased: new Map([[1, CORNER]]) }, 1);
    const sprite = pe.container.children[0] as Sprite;
    const bake = textures.erased(page, FRAME, CORNER, body);
    expect(sprite.texture.source).toBe(bake?.source);
    expect(sprite.position).toMatchObject({ x: -5, y: -9 });
    binder.bind(pe, item, [body], frame, 2);
    expect(sprite.texture).toBe(textures.get(page, FRAME));
    pe.container.destroy({ children: true });
  });
});
