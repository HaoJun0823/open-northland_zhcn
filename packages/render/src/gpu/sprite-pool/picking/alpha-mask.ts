import type { TextureSource } from 'pixi.js';
import { isIndexedSource } from '../../pixel-art/registry.js';
import {
  type DrawableResource,
  isDrawableResource,
  readable2dContext,
} from '../../textures/drawable-resource.js';

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
const RGBA = 4;

/**
 * Rows read back per band of a page's mask. A band is read on the first test that lands in it, so a
 * hover reads a few hundred KB instead of a whole page (up to 45 MB) in one frame. A multiple of 8, so
 * every band starts on a byte of the packed bits.
 */
export const MASK_BAND_ROWS = 64;

/** A 1-bit solid/transparent mask over a whole atlas sheet, row-major and bit-packed. */
export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
  /** Fills the band holding row `y` when its bits are not read yet; absent on a mask built whole. */
  readonly ensureRow?: (y: number) => void;
}

/** Sets the bit of every texel of `rows` rows from `y0` whose coverage reaches the threshold. */
function packRows(
  bits: Uint8Array,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  y0: number,
  rows: number,
  coverageChannel: number,
): void {
  const first = y0 * width;
  const count = rows * width;
  for (let p = 0; p < count; p++) {
    if ((rgba[p * RGBA + coverageChannel] ?? 0) < SOLID_ALPHA_MIN) continue;
    const i = first + p;
    bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
  }
}

export function buildAlphaMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  coverageChannel = ALPHA_CHANNEL,
): AlphaMask {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  packRows(bits, rgba, width, 0, height, coverageChannel);
  return { width, height, bits };
}

/**
 * A mask whose bands are read on demand through `readRows`, which answers the RGBA pixels of `rows`
 * page rows from `y0`, or `null` when they cannot be read (the band then stays transparent).
 */
export function lazyAlphaMask(
  width: number,
  height: number,
  coverageChannel: number,
  readRows: (y0: number, rows: number) => Uint8Array | Uint8ClampedArray | null,
): AlphaMask {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  const read = new Uint8Array(Math.ceil(height / MASK_BAND_ROWS));
  const ensureRow = (y: number): void => {
    const band = Math.floor(y / MASK_BAND_ROWS);
    if (read[band] === 1) return;
    read[band] = 1;
    const y0 = band * MASK_BAND_ROWS;
    const rows = Math.min(MASK_BAND_ROWS, height - y0);
    const rgba = readRows(y0, rows);
    if (rgba !== null) packRows(bits, rgba, width, y0, rows, coverageChannel);
  };
  return { width, height, bits, ensureRow };
}

/** Out-of-range coordinates read as transparent. */
export function maskSolidAt(mask: AlphaMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  mask.ensureRow?.(y);
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

/** One band-sized 2d context reused for every page's reads, resized to the widest page asked for. */
let scratch: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function scratchContext(width: number): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (scratch === null || scratch.canvas.width < width) {
    scratch = readable2dContext(width, MASK_BAND_ROWS);
    if (scratch !== null) scratch.imageSmoothingEnabled = false;
  }
  return scratch;
}

/** The RGBA pixels of `rows` rows of `resource` from `y0`, or `null` when they cannot be read (no 2d
 *  context in a headless environment, or a closed or undecodable image). */
function readRows(
  resource: DrawableResource,
  width: number,
  y0: number,
  rows: number,
): Uint8ClampedArray | null {
  const ctx = scratchContext(width);
  if (ctx === null) return null;
  try {
    ctx.clearRect(0, 0, width, rows);
    ctx.drawImage(resource, 0, y0, width, rows, 0, 0, width, rows);
    return ctx.getImageData(0, 0, width, rows).data;
  } catch {
    return null;
  }
}

/**
 * The alpha mask of an atlas sheet from the texture's CPU-side image, read band by band as tests land
 * in it, or `null` when the pixels are unreadable - the picker then falls back to the AABB hit. One row
 * is read at once, so an unreadable image is known before any caller relies on the mask.
 */
export function alphaMaskOf(source: TextureSource): AlphaMask | null {
  const cached = maskCache.get(source);
  if (cached !== undefined) return cached;
  const resource: unknown = source.resource;
  const width = source.pixelWidth;
  const height = source.pixelHeight;
  let mask: AlphaMask | null = null;
  if (isDrawableResource(resource) && readRows(resource, width, 0, 1) !== null) {
    const channel = isIndexedSource(source) ? INDEXED_COVERAGE_CHANNEL : ALPHA_CHANNEL;
    mask = lazyAlphaMask(width, height, channel, (y0, rows) => readRows(resource, width, y0, rows));
  }
  maskCache.set(source, mask);
  return mask;
}
