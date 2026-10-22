import { CanvasSource, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { isDrawableResource, readable2dContext } from './drawable-resource.js';
import { isPixelArtSource, markPixelArtSource } from './pixel-art-registry.js';

/** A box in a body's draw-anchor px (+y down), the space its frame offsets and mast points use;
 *  `max` edges are exclusive. */
export interface AnchorRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The parts of a body's art a mark replaces while it stands there, such as a tower's roof finial
 *  under its garrison flag. */
export type ErasedRegion = readonly AnchorRect[];

/** How a layer places its frame on the anchor: anchor px = `d + (offset + frame px) * scale`. */
export interface FramePlacement {
  readonly scale: number;
  readonly dx?: number;
  readonly dy?: number;
}

/** A frame copied onto a page of its own with a region cleared, drawn in place of the atlas frame. */
export interface ErasedFrame {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
}

/**
 * Atlas frames copied with an {@link ErasedRegion} cleared, one bake per frame and region. A region that
 * misses the frame, or pixels a canvas cannot read, bake nothing: the caller draws the atlas frame.
 */
export class ErasedFrameCache {
  private readonly bakes = new Map<AtlasFrame, Map<ErasedRegion, ErasedFrame | null>>();

  get(
    source: TextureSource,
    frame: AtlasFrame,
    region: ErasedRegion,
    placement: FramePlacement,
  ): ErasedFrame | null {
    let byRegion = this.bakes.get(frame);
    if (byRegion === undefined) {
      byRegion = new Map();
      this.bakes.set(frame, byRegion);
    }
    let bake = byRegion.get(region);
    if (bake === undefined) {
      bake = bakeErased(source, frame, region, placement);
      byRegion.set(region, bake);
    }
    // The copy follows its atlas page's sampling, which the zoom and the art filter flip; a flip bumps
    // the texture revision, so every holder asks again.
    if (bake !== null) bake.source.scaleMode = source.scaleMode;
    return bake;
  }

  /** Destroy every bake with its page. */
  clear(): void {
    for (const byRegion of this.bakes.values()) {
      for (const bake of byRegion.values()) bake?.source.destroy();
    }
    this.bakes.clear();
  }
}

function bakeErased(
  source: TextureSource,
  frame: AtlasFrame,
  region: ErasedRegion,
  { scale, dx = 0, dy = 0 }: FramePlacement,
): ErasedFrame | null {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const rect of region) {
    const x0 = Math.max(0, Math.round((rect.minX - dx) / scale - frame.offsetX));
    const y0 = Math.max(0, Math.round((rect.minY - dy) / scale - frame.offsetY));
    const x1 = Math.min(frame.width, Math.round((rect.maxX - dx) / scale - frame.offsetX));
    const y1 = Math.min(frame.height, Math.round((rect.maxY - dy) / scale - frame.offsetY));
    if (x1 > x0 && y1 > y0) boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  if (boxes.length === 0) return null;
  const resource: unknown = source.resource;
  if (!isDrawableResource(resource)) return null;
  const ctx = readable2dContext(frame.width, frame.height);
  if (ctx === null) return null;
  try {
    ctx.drawImage(resource, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  } catch {
    return null; // a closed or undecodable image
  }
  for (const box of boxes) ctx.clearRect(box.x, box.y, box.w, box.h);
  const page = new CanvasSource({
    resource: ctx.canvas,
    scaleMode: source.scaleMode,
    autoGenerateMipmaps: source.autoGenerateMipmaps,
  });
  if (isPixelArtSource(source)) markPixelArtSource(page);
  return { source: page, frame: { ...frame, x: 0, y: 0 } };
}
