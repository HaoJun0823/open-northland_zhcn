import type { TextureSource } from 'pixi.js';
import { isIndexedSource } from '../pixel-art/registry.js';
import {
  type DrawableResource,
  isDrawableResource,
  readable2dContext,
} from '../textures/drawable-resource.js';

/**
 * Per-atlas alpha masks refining the picker's AABB hit to the drawn texel. Pixel hit-testing is a
 * deliberate deviation from the original's observed footprint-based house selection.
 */

/**
 * Minimum alpha (0..255) a texel needs to count as clickable. Half-opacity keeps a decoded
 * `Double8Bit` bob's anti-aliased body edge clickable while dropping its soft shadow skirt and glow.
 * Approximation: no measurable oracle, since the original never alpha-picks.
 */
export const SOLID_ALPHA_MIN = 128;

/** The channel a sheet's coverage is in: alpha, or green on an indexed (opaque) sheet. */
const ALPHA_CHANNEL = 3;
const INDEXED_COVERAGE_CHANNEL = 1;

/** A 1-bit solid/transparent mask over a whole atlas sheet, row-major and bit-packed. */
export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

export function buildAlphaMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  coverageChannel = ALPHA_CHANNEL,
): AlphaMask {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + coverageChannel] ?? 0;
    if (alpha >= SOLID_ALPHA_MIN) {
      bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
    }
  }
  return { width, height, bits };
}

/** Out-of-range coordinates read as transparent. */
export function maskSolidAt(mask: AlphaMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const i = y * mask.width + x;
  return ((mask.bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

/** Lazily-built masks per atlas sheet; a dropped source releases its mask with it. `null` is cached
 *  too, so an unreadable source is not retried on every click. */
const maskCache = new WeakMap<TextureSource, AlphaMask | null>();

/** A mutable atlas changed its pixels; the next pick reads its current coverage. */
export function invalidateAlphaMask(source: TextureSource): void {
  maskCache.delete(source);
}

/** Read the RGBA pixels of a drawable via a throwaway 2d canvas, or `null` when no 2d context exists
 *  (a headless environment without canvas). */
function readPixels(resource: DrawableResource, width: number, height: number): ImageData | null {
  const ctx = readable2dContext(width, height);
  if (ctx === null) return null;
  try {
    ctx.drawImage(resource, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null; // tainted/undecodable source - the caller falls back to the box hit
  }
}

/**
 * The alpha mask of an atlas sheet, built once on first use from the texture's CPU-side image, or
 * `null` when the pixels are unreadable - the picker then falls back to the AABB hit.
 */
export function alphaMaskOf(source: TextureSource): AlphaMask | null {
  const cached = maskCache.get(source);
  if (cached !== undefined) return cached;
  const resource: unknown = source.resource;
  const mask = isDrawableResource(resource)
    ? (() => {
        const pixels = readPixels(resource, source.pixelWidth, source.pixelHeight);
        if (pixels === null) return null;
        const channel = isIndexedSource(source) ? INDEXED_COVERAGE_CHANNEL : ALPHA_CHANNEL;
        return buildAlphaMask(pixels.data, pixels.width, pixels.height, channel);
      })()
    : null;
  maskCache.set(source, mask);
  return mask;
}
