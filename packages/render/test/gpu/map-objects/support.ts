import type { Container, Mesh, Texture } from 'pixi.js';
import type { Viewport } from '../../../src/data/projection/index.js';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import { CLIP_FLOATS, NO_CLIP } from '../../../src/gpu/map-objects/decor-clip.js';
import type { MapObjectLayer } from '../../../src/gpu/map-objects/index.js';

/**
 * The {@link MapObjectLayer}'s GPU state is the only place its decisions are observable, so these read
 * its batch geometry and attached sprites directly and own that coupling for every spec.
 */

/** Same size, distinct `x`, so the pose in play is readable off a bound frame or a written quad's UVs. */
export const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
export const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };

/** Frames everything the tests place; their world coords are single-digit px. */
export const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** The decor container's single batch mesh: one source, one still/moving split. */
function decorBatchGeometry(layer: MapObjectLayer): { positions: Float32Array; uvs: Float32Array } {
  const mesh = layer.decorContainer.children[0]?.children[0] as {
    geometry?: { positions: Float32Array; uvs: Float32Array };
  };
  const geometry = mesh?.geometry;
  if (geometry === undefined) throw new Error('expected one decor batch mesh');
  return geometry;
}

/** A quad's placement is observable as its written vertices. */
export function decorPositions(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).positions;
}

/** A quad's frame pick is observable as its atlas UVs. */
export function decorUVs(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).uvs;
}

export interface TallSprite {
  readonly x: number;
  readonly y: number;
  readonly tint: number;
  readonly frameX: number;
  readonly zIndex: number;
  readonly visible: boolean;
}

/** The tall sprites attached to the layer's sprite container, in child order; empty while hidden. */
export function tallSprites(spriteLayer: Container): TallSprite[] {
  return spriteLayer.children.map((c) => {
    const spr = c as unknown as {
      x: number;
      y: number;
      tint: number;
      texture: Texture;
      zIndex: number;
      visible: boolean;
    };
    return {
      x: spr.x,
      y: spr.y,
      tint: spr.tint,
      frameX: spr.texture.frame.x,
      zIndex: spr.zIndex,
      visible: spr.visible,
    };
  });
}

/** The frame `decorClipFrame` picks: `count` is signed as in `aClip`. */
function clipFrameIndex(count: number, start: number, tick: number): number {
  const frames = Math.abs(count);
  return count < 0 ? Math.min(Math.max(tick - start, 0), frames - 1) : (tick + start) % frames;
}

/** The tick a clip plays at: the frame tick while its cell is watched or the fog is off, else 0. */
function clipTick(scale: number, tick: number, fogOn: boolean): number {
  return scale > 0 || !fogOn ? tick : 0;
}

/** What the GPU draws of one quad of a paged decor mesh at `tick`: its corners, UVs and frame bounds
 *  as the vertex shader places them, null for a collapsed quad. Mirrors `decorClipVertex`, which a
 *  browser test runs against the CPU's frame pick and placement. */
export interface DrawnDecorQuad {
  readonly positions: number[];
  readonly uvs: number[];
  readonly bounds: number[];
}

const QUAD_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;
const CLIP_ENTRY_TEXELS = 3;
const RGBA = 4;

export function drawnDecorQuad(mesh: Mesh, quad: number, tick: number, fogOn = false): DrawnDecorQuad | null {
  const geometry = mesh.geometry;
  const clipData = geometry.getBuffer('aClip').data as Float32Array;
  const at = quad * QUAD_CORNERS.length * CLIP_FLOATS;
  const [entry = 0, count = 0, start = 0, scale = 0] = clipData.slice(at, at + CLIP_FLOATS);
  const positions = [...(geometry.getBuffer('aPosition').data as Float32Array).slice(quad * 8, quad * 8 + 8)];
  const uvs = [...(geometry.getBuffer('aUV').data as Float32Array).slice(quad * 8, quad * 8 + 8)];
  const frames =
    geometry.attributes.aFrame === undefined ? null : (geometry.getBuffer('aFrame').data as Float32Array);
  const bounds = frames === null ? [] : [...frames.slice(quad * 16, quad * 16 + 4)];
  if (count === NO_CLIP) return positions.every((value) => value === 0) ? null : { positions, uvs, bounds };
  const table = (mesh.shader?.resources as { uDecorFrames?: { resource: Float32Array } } | undefined)
    ?.uDecorFrames?.resource;
  if (table === undefined) throw new Error('expected a clip table');
  const frame = clipFrameIndex(count, start, clipTick(scale, tick, fogOn));
  const texel = (entry + frame) * CLIP_ENTRY_TEXELS * RGBA;
  const [x, y, w, h] = [...table.slice(texel, texel + RGBA)] as [number, number, number, number];
  if (w <= 0) return null;
  const uvRect = [...table.slice(texel + RGBA, texel + 2 * RGBA)] as [number, number, number, number];
  const anchors = geometry.getBuffer('aAnchor').data as Float32Array;
  const [ax = 0, ay = 0] = anchors.slice(quad * 8, quad * 8 + 2);
  const size = Math.abs(scale);
  const toF32 = Math.fround;
  return {
    positions: QUAD_CORNERS.flatMap(([fx, fy]) => [
      toF32(toF32(ax + x * size) + fx * w * size),
      toF32(toF32(ay + y * size) + fy * h * size),
    ]),
    uvs: QUAD_CORNERS.flatMap(([fx, fy]) => [
      fx === 0 ? uvRect[0] : uvRect[2],
      fy === 0 ? uvRect[1] : uvRect[3],
    ]),
    bounds: [...table.slice(texel + 2 * RGBA, texel + 3 * RGBA)],
  };
}
