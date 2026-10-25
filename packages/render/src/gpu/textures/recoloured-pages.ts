import { ATLAS_PALETTE_BYTES } from '@open-northland/formats/atlas/paletted-sheet';
import {
  BufferImageSource,
  ExtensionType,
  extensions,
  type GLTextureUploader,
  glUploadBufferImageResource,
  type SCALE_MODE,
  type Texture,
  type TextureSource,
} from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import {
  markIndexedSource,
  markPalettedTexture,
  markPixelArtSource,
  palettedLutOf,
  palettedRowOf,
} from '../pixel-art/registry.js';
import { admitResidentPage } from './atlas-residency.js';
import { type DrawableResource, isDrawableResource, readable2dContext } from './drawable-resource.js';

/**
 * A bob set's recolours share one indexed sheet; each recolour (a stem) is that sheet seen through its
 * own 256-entry palette. The shared page holds palette index and coverage per texel and is drawn
 * through a LUT row per stem, so a set of N recolours costs one page instead of N coloured ones.
 */

const UPLOAD_METHOD = 'recoloured-page';
/** Bytes per texel of a recoloured page: palette index, coverage. */
const INDEX_COVERAGE_BYTES = 2;
const COVERAGE_BYTE = 1;
const RGB = 3;
const RGBA = 4;
const ALPHA = 3;
/** WebGL's default row alignment; an RG8 row of odd width is not a multiple of it. */
const DEFAULT_UNPACK_ALIGNMENT = 4;
/** CPU copies of coloured frames kept for readers, least recently used out first. */
const COLOURED_FRAME_BUDGET_BYTES = 32 * 1024 * 1024;

/** The shared indexed page of a bob set's recolours: palette index in red, coverage in green, two bytes
 *  a texel on the CPU and on the GPU. The CPU copy stays for the readers and for a re-upload after the
 *  residency budget unloaded the page. */
export class RecolouredPageSource extends BufferImageSource {
  /** The sampling named by {@link scaleMode}, which never reaches the page's sampler. */
  private nominalScaleMode: SCALE_MODE = 'nearest';

  constructor(
    readonly indexCoverage: Uint8Array,
    width: number,
    height: number,
  ) {
    super({
      resource: indexCoverage,
      width,
      height,
      format: 'rg8unorm',
      scaleMode: 'nearest',
      // What the shaders draw from the page is premultiplied, and Pixi blends a page it is told is not
      // as straight alpha. Premultiplying on upload leaves the two channels of an RG page as they are.
      alphaMode: 'premultiply-alpha-on-upload',
    });
    if (indexCoverage.length !== width * height * INDEX_COVERAGE_BYTES) {
      throw new Error(`recoloured page: ${indexCoverage.length} bytes for ${width}x${height}`);
    }
    this.uploadMethodId = UPLOAD_METHOD;
    this.autoGarbageCollect = false;
    markPixelArtSource(this);
    markIndexedSource(this);
  }

  /**
   * The sampling the world's flip names, which the RGBA copies baked from a frame (reveal, grounded and
   * erased bakes, colour copies) take at creation. The page's own sampler is fixed nearest: its indices
   * must never blend.
   */
  override get scaleMode(): SCALE_MODE {
    return this.nominalScaleMode;
  }

  override set scaleMode(mode: SCALE_MODE) {
    this.nominalScaleMode = mode;
  }
}

/** Pixi's buffer upload with byte-aligned rows, then the residency budget. */
const RECOLOURED_PAGE_UPLOADER: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation) {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    try {
      glUploadBufferImageResource.upload(
        source,
        glTexture,
        gl,
        webGLVersion,
        targetOverride,
        forceAllocation,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, DEFAULT_UNPACK_ALIGNMENT);
    }
    admitResidentPage(source);
  },
};

let uploaderRegistered = false;

/** Teach WebGL renderers the recoloured page upload; a renderer copies its uploaders when it is built,
 *  so this runs before any is. */
export function registerRecolouredPageUploader(): void {
  if (uploaderRegistered) return;
  uploaderRegistered = true;
  extensions.add({
    type: ExtensionType.TextureUploaderWebGL,
    name: UPLOAD_METHOD,
    ref: RECOLOURED_PAGE_UPLOADER,
  });
}

/**
 * The palette a recoloured stem's frame draws through, kept on the frame under a symbol. It is an
 * enumerable own property, so a frame derived by spreading another (a sign's cropped chain frame, a
 * look's feet-shifted atlas) draws through the same palette. A stem's frames are its own objects.
 */
// A registered symbol, so a second instance of this module (a development hot reload) reads it too.
const RECOLOUR = Symbol.for('open-northland.recolour-palette');
type RecolouredFrame = AtlasFrame & { [RECOLOUR]?: Uint8Array };

export function registerRecolouredFrames(frames: Iterable<AtlasFrame>, palette: Uint8Array): void {
  if (palette.length !== ATLAS_PALETTE_BYTES) {
    throw new Error(`recoloured frames: palette of ${palette.length} bytes`);
  }
  for (const frame of frames) {
    Object.defineProperty(frame, RECOLOUR, { value: palette, enumerable: true, configurable: true });
  }
}

/** The palette `frame` draws its shared indexed page through, or undefined for any other frame. */
export function recolourOf(frame: AtlasFrame): Uint8Array | undefined {
  return (frame as RecolouredFrame)[RECOLOUR];
}

/**
 * `frame` of `page` coloured through `palette` into straight RGBA `out` (frame-sized, row-major): a
 * covered texel takes its palette colour with its coverage as alpha, an uncovered one is all zero, the
 * bytes the pipeline's RGB bake of the stem holds.
 */
export function colourRecolouredFrame(
  page: RecolouredPageSource,
  frame: Pick<AtlasFrame, 'x' | 'y' | 'width' | 'height'>,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray,
): void {
  const pixels = page.indexCoverage;
  const pageWidth = page.pixelWidth;
  let o = 0;
  for (let y = 0; y < frame.height; y++) {
    let i = ((frame.y + y) * pageWidth + frame.x) * INDEX_COVERAGE_BYTES;
    for (let x = 0; x < frame.width; x++, i += INDEX_COVERAGE_BYTES, o += RGBA) {
      const coverage = pixels[i + COVERAGE_BYTE] ?? 0;
      if (coverage === 0) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + ALPHA] = 0;
        continue;
      }
      const p = (pixels[i] ?? 0) * RGB;
      out[o] = palette[p] ?? 0;
      out[o + 1] = palette[p + 1] ?? 0;
      out[o + 2] = palette[p + 2] ?? 0;
      out[o + ALPHA] = coverage;
    }
  }
}

/** Where a frame's pixels can be drawn from with `drawImage`: an image and the frame's corner in it. */
export interface DrawableFrame {
  readonly image: DrawableResource;
  readonly x: number;
  readonly y: number;
}

type ColouredCanvas = NonNullable<ReturnType<typeof readable2dContext>>['canvas'];
/** The rectangle of a page a coloured copy covers. */
type PageRect = Pick<AtlasFrame, 'x' | 'y' | 'width' | 'height'>;

/** Coloured copies of recoloured frames by the frame or texture asked for, oldest use first. */
const colouredCopies = new Map<object, ColouredCanvas>();
let colouredBytes = 0;

/** A canvas holding `rect` of `page` coloured through `palette`, made on first ask for `key` and kept
 *  within the budget; null without a 2d context. */
function colouredCanvas(
  key: object,
  page: RecolouredPageSource,
  rect: PageRect,
  palette: Uint8Array,
): ColouredCanvas | null {
  const kept = colouredCopies.get(key);
  if (kept !== undefined) {
    colouredCopies.delete(key);
    colouredCopies.set(key, kept);
    return kept;
  }
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ctx = readable2dContext(rect.width, rect.height);
  if (ctx === null) return null;
  const image = ctx.createImageData(rect.width, rect.height);
  colourRecolouredFrame(page, rect, palette, image.data);
  ctx.putImageData(image, 0, 0);
  colouredCopies.set(key, ctx.canvas);
  colouredBytes += rect.width * rect.height * RGBA;
  for (const [old, canvas] of colouredCopies) {
    if (colouredBytes <= COLOURED_FRAME_BUDGET_BYTES || old === key) break;
    colouredCopies.delete(old);
    colouredBytes -= canvas.width * canvas.height * RGBA;
  }
  return ctx.canvas;
}

/**
 * Where to `drawImage` `frame` of `source` from to read its colours: the page's own image at the
 * frame's rectangle, or for a recoloured page a coloured copy of the frame alone. Null when the pixels
 * cannot be read (a buffer page that is not recoloured, no 2d context).
 */
export function drawableFrame(source: TextureSource, frame: AtlasFrame): DrawableFrame | null {
  if (source instanceof RecolouredPageSource) {
    const palette = recolourOf(frame);
    const canvas = palette === undefined ? null : colouredCanvas(frame, source, frame, palette);
    return canvas === null ? null : { image: canvas, x: 0, y: 0 };
  }
  const resource: unknown = source.resource;
  return isDrawableResource(resource) ? { image: resource, x: frame.x, y: frame.y } : null;
}

/** Each view of a recoloured frame the texture cache mints, and the palette it draws through. */
const paletteOfTexture = new WeakMap<Texture, Uint8Array>();

export function registerRecolouredTexture(texture: Texture, palette: Uint8Array): void {
  paletteOfTexture.set(texture, palette);
}

/** {@link drawableFrame} for a texture's own frame rectangle, for readers holding only the view. */
export function drawableTexture(texture: Texture): DrawableFrame | null {
  const { source, frame } = texture;
  const rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  if (source instanceof RecolouredPageSource) {
    const palette = paletteOfTexture.get(texture);
    const kept = colouredCopies.has(texture);
    const canvas = palette === undefined ? null : colouredCanvas(texture, source, rect, palette);
    // A destroyed view's copy goes with it rather than waiting for the budget.
    if (canvas !== null && !kept) texture.once('destroy', () => forgetColoured(texture));
    return canvas === null ? null : { image: canvas, x: 0, y: 0 };
  }
  const resource: unknown = source.resource;
  return isDrawableResource(resource) ? { image: resource, x: rect.x, y: rect.y } : null;
}

function forgetColoured(key: object): void {
  const canvas = colouredCopies.get(key);
  if (canvas === undefined) return;
  colouredCopies.delete(key);
  colouredBytes -= canvas.width * canvas.height * RGBA;
}

/** Gives `to`, a view of the same frame as `from`, the LUT, row and palette a recoloured `from` draws
 *  through. */
export function copyRecolour(from: Texture, to: Texture): void {
  const palette = paletteOfTexture.get(from);
  const lut = palettedLutOf(from);
  if (palette === undefined || lut === undefined) return;
  markPalettedTexture(to, lut, palettedRowOf(from));
  paletteOfTexture.set(to, palette);
}

/**
 * `frame`'s straight RGBA pixels, frame-sized and row-major: a recoloured frame coloured with no canvas
 * in between (about the cost of reading a coloured bitmap back), any other frame read back from its
 * page's image. Null when the pixels cannot be read.
 */
export function readFrameRgba(
  source: TextureSource,
  frame: AtlasFrame,
): Uint8ClampedArray<ArrayBuffer> | null {
  const { width, height } = frame;
  if (width <= 0 || height <= 0) return null;
  if (source instanceof RecolouredPageSource) {
    const palette = recolourOf(frame);
    if (palette === undefined) return null;
    const out = new Uint8ClampedArray(width * height * RGBA);
    colourRecolouredFrame(source, frame, palette, out);
    return out;
  }
  const resource: unknown = source.resource;
  if (!isDrawableResource(resource)) return null;
  const ctx = readable2dContext(width, height);
  if (ctx === null) return null;
  try {
    ctx.drawImage(resource, frame.x, frame.y, width, height, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null; // a closed, undecodable or tainted image
  }
}

/**
 * Draws `frame`'s colours into `ctx` at (`dx`, `dy`), onto a clear area: a recoloured frame put as its
 * coloured pixels, any other frame drawn from its page's image. False when the pixels cannot be read.
 */
export function drawFrameInto(
  ctx: NonNullable<ReturnType<typeof readable2dContext>>,
  source: TextureSource,
  frame: AtlasFrame,
  dx: number,
  dy: number,
): boolean {
  const { width, height } = frame;
  if (source instanceof RecolouredPageSource) {
    const pixels = readFrameRgba(source, frame);
    if (pixels === null) return false;
    ctx.putImageData(new ImageData(pixels, width, height), dx, dy);
    return true;
  }
  const resource: unknown = source.resource;
  if (!isDrawableResource(resource)) return false;
  ctx.drawImage(resource, frame.x, frame.y, width, height, dx, dy, width, height);
  return true;
}

/**
 * The pixels of `ctx`'s whole area with `frame` at (`dx`, `dy`) on clear ground, for a reader that
 * reworks them and puts them back: a recoloured frame coloured straight into the image, with no canvas
 * draw or read back, any other frame drawn from its page's image and read back. Null when the pixels
 * cannot be read.
 */
export function frameImageData(
  ctx: NonNullable<ReturnType<typeof readable2dContext>>,
  source: TextureSource,
  frame: AtlasFrame,
  dx: number,
  dy: number,
): ImageData | null {
  const { width, height } = ctx.canvas;
  if (source instanceof RecolouredPageSource) {
    const pixels = readFrameRgba(source, frame);
    if (pixels === null) return null;
    const image = ctx.createImageData(width, height);
    const rowBytes = frame.width * RGBA;
    for (let y = 0; y < frame.height; y++) {
      image.data.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), ((y + dy) * width + dx) * RGBA);
    }
    return image;
  }
  if (!drawFrameInto(ctx, source, frame, dx, dy)) return null;
  return ctx.getImageData(0, 0, width, height);
}
