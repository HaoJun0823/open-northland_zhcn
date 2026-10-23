/**
 * Bob atlas bakes: how one decoded `.bmd` frame turns into sheet pixels. Index 0 is a real palette
 * colour for bobs, so alpha always comes from a frame's `mask`.
 */

import type { BobFrame } from '../bmd/index.js';
import { BOB_ALPHA_OPAQUE } from '../bmd/index.js';
import { assertPaletteBytes, paletteToRgba, type RgbaImage } from '../image.js';
import type { GreyAlphaImage } from '../png.js';

/**
 * How an atlas reads a Double8Bit pair's second byte:
 *
 *  - `'per-pixel'`: the byte is coverage and bakes into the sheet's alpha as-is, keeping the decals'
 *    authored feathered translucency.
 *  - `'build-time'`: the byte is a 0-255 construction-progress threshold, not coverage. Measured on
 *    the `[GfxHouse]` bobs: it spans ~0-255 and is strongly row-correlated bottom-up (foundation low,
 *    roof high; ≈100 mean across solid walls). Every written pixel bakes fully opaque into the colour
 *    sheet, and the thresholds bake into a second, same-placement grayscale sheet a renderer reveals
 *    pixel by pixel as construction progresses.
 */
export type AtlasAlphaMode = 'per-pixel' | 'build-time';

/** Expands one decoded frame into one RGBA plane. Called only for frames that have pixels. */
type BobPlane = (frame: BobFrame) => RgbaImage;

/**
 * How a decoded bob turns into sheet pixels. `secondByte` is the reading `decodeBobFrame` applies to a
 * double-byte pair, and it is the tag: only a `'time'` bake also fills a build-progress plane.
 */
export type BobBake =
  | { readonly secondByte: 'alpha'; readonly plane: BobPlane }
  | { readonly secondByte: 'time'; readonly plane: BobPlane; readonly time: BobPlane };

/** Colours one decoded frame through a 256-entry RGB palette, taking alpha from its `mask`: unwritten
 *  is fully transparent, written carries its 0-255 coverage. */
export function expandBobFrame(frame: BobFrame, palette: Uint8Array): RgbaImage {
  assertPaletteBytes(palette, 'atlas');
  const { width, height, pixels, mask } = frame;
  return { width, height, rgba: paletteToRgba(pixels, palette, (i) => mask[i] ?? 0) };
}

/** The indexed layout's channels: palette index in red, coverage in green, blue 0, alpha always opaque.
 *  An opaque image decodes the same with or without premultiplication, so any plain image decode (a
 *  2d canvas, a premultiplied texture upload) reads the index and coverage back exactly. */
const INDEXED_INDEX_CHANNEL = 0;
const INDEXED_COVERAGE_CHANNEL = 1;
const ALPHA_CHANNEL = 3;

/** One indexed pixel: {@link INDEXED_INDEX_CHANNEL}, {@link INDEXED_COVERAGE_CHANNEL}, opaque. */
export function writeIndexedPixel(rgba: Uint8Array, offset: number, index: number, coverage: number): void {
  rgba[offset + INDEXED_INDEX_CHANNEL] = index;
  rgba[offset + INDEXED_COVERAGE_CHANNEL] = coverage;
  rgba[offset + ALPHA_CHANNEL] = BOB_ALPHA_OPAQUE;
}

/**
 * An indexed-layout image in the displacement layout: the value in red where covered, the coverage in
 * alpha, every other byte 0. A renderer uploads it straight, so the red byte reaches the shader as is.
 */
export function indexedToDisplacement(image: RgbaImage): RgbaImage {
  const { width, height, rgba } = image;
  const out = new Uint8Array(rgba.length);
  for (let o = 0; o < rgba.length; o += 4) {
    const coverage = rgba[o + INDEXED_COVERAGE_CHANNEL] ?? 0;
    if (coverage === 0) continue;
    out[o] = rgba[o + INDEXED_INDEX_CHANNEL] ?? 0;
    out[o + ALPHA_CHANNEL] = coverage;
  }
  return { width, height, rgba: out };
}

/** An indexed-layout image as grey + alpha: the palette index in grey, the coverage in alpha. */
export function indexedToGreyAlpha(image: RgbaImage): GreyAlphaImage {
  const { width, height, rgba } = image;
  const pixels = new Uint8Array(width * height * 2);
  for (let i = 0, o = 0; o < rgba.length; i += 2, o += 4) {
    pixels[i] = rgba[o + INDEXED_INDEX_CHANNEL] ?? 0;
    pixels[i + 1] = rgba[o + INDEXED_COVERAGE_CHANNEL] ?? 0;
  }
  return { width, height, pixels };
}

/**
 * A frame in the indexed layout ({@link INDEXED_COVERAGE_CHANNEL}): the `mask` is the coverage and an
 * unwritten pixel is index 0 at coverage 0. Colour is deferred to the renderer, which reads each index
 * through a per-player palette LUT so a clothing band recolours at draw time.
 */
export function expandBobFrameIndexed(frame: BobFrame): RgbaImage {
  const { width, height, pixels, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const coverage = mask[i] ?? 0;
    writeIndexedPixel(rgba, i * 4, coverage === 0 ? 0 : (pixels[i] ?? 0), coverage);
  }
  return { width, height, rgba };
}

/**
 * The build-progress plane of a `'time'`-decoded frame: R=G=B is the pixel's 0-255 threshold, alpha 255
 * where written and 0 elsewhere. Grayscale, so the emitted time sheet is inspectable by eye.
 */
function expandBobFrameTime(frame: BobFrame): RgbaImage {
  const { width, height, mask, time } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const t = time?.[i] ?? 0;
    const o = i * 4;
    rgba[o] = t;
    rgba[o + 1] = t;
    rgba[o + 2] = t;
    rgba[o + 3] = BOB_ALPHA_OPAQUE;
  }
  return { width, height, rgba };
}

/**
 * The baked alpha of a shadow-atlas pixel. An approximation: the original's shadow alpha is not
 * established, so this adopts the value another reimplementation matched against the running original.
 */
export const SHADOW_ALPHA = 0x50;

/** Every written pixel black at {@link SHADOW_ALPHA}, every unwritten one fully transparent. No
 *  palette: the darkening belongs to the blit, not the art. */
function expandBobFrameShadow(frame: BobFrame): RgbaImage {
  const { width, height, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) === 0) continue; // transparent: leave RGBA all-zero
    rgba[i * 4 + 3] = SHADOW_ALPHA;
  }
  return { width, height, rgba };
}

export function colouredBake(palette: Uint8Array, alpha: AtlasAlphaMode): BobBake {
  const plane = (frame: BobFrame): RgbaImage => expandBobFrame(frame, palette);
  return alpha === 'build-time'
    ? { secondByte: 'time', plane, time: expandBobFrameTime }
    : { secondByte: 'alpha', plane };
}

export const INDEXED_BAKE: BobBake = { secondByte: 'alpha', plane: expandBobFrameIndexed };

/** The indexed counterpart of {@link colouredBake}: the same mask and time plane, in the indexed layout. */
export function indexedBake(alpha: AtlasAlphaMode): BobBake {
  return alpha === 'build-time'
    ? { secondByte: 'time', plane: expandBobFrameIndexed, time: expandBobFrameTime }
    : INDEXED_BAKE;
}

export const SHADOW_BAKE: BobBake = { secondByte: 'alpha', plane: expandBobFrameShadow };
