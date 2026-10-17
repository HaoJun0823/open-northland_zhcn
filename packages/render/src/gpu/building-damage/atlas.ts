import {
  CanvasSource,
  ExtensionType,
  extensions,
  type GLTextureUploader,
  type GlRenderingContext,
  type GlTexture,
  glUploadImageResource,
  Rectangle,
  Texture,
  type TextureSource,
} from 'pixi.js';
import { readable2dContext } from '../drawable-resource.js';
import { isMagnifiedTexture, markMagnifiedTexture, markPixelArtSource } from '../pixel-art-registry.js';
import { invalidateAlphaMask } from '../sprite-pool/alpha-mask.js';

const SIDE = 1024;
const CELL = 32;
const GRID = SIDE / CELL;
const MAX_PAGES = 4;
const PAD = 2;

export interface DamageTile {
  readonly texture: Texture;
  readonly page: DamagePage;
  readonly x: number;
  readonly y: number;
  readonly cols: number;
  readonly rows: number;
}

interface DamagePage {
  readonly context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  readonly source: DamagePageSource;
  readonly occupied: Uint8Array;
  dirty: boolean;
}

const UPLOAD_METHOD = 'damage-page';
/** Pixi's uploaders take WebGL 2 on this version number. */
const WEBGL2 = 2;

/** A page that remembers the canvas rectangles written since its last upload, so an upload to a texture
 *  the GPU already holds copies those alone instead of the whole page. */
export class DamagePageSource extends CanvasSource {
  /** `x, y, width, height` per written rectangle, in canvas pixels. */
  readonly written: number[] = [];

  constructor(canvas: OffscreenCanvas | HTMLCanvasElement) {
    super({ resource: canvas, scaleMode: 'linear' });
    this.uploadMethodId = UPLOAD_METHOD;
  }

  markWritten(x: number, y: number, width: number, height: number): void {
    this.written.push(x, y, width, height);
  }
}

/** Copy `source`'s written rectangles into `glTexture`; false when the texture needs the whole page. */
function uploadWritten(
  source: DamagePageSource,
  glTexture: GlTexture,
  gl: GlRenderingContext,
  webGLVersion: number,
  target: number,
): boolean {
  const { written } = source;
  const allocated = glTexture.width === source.pixelWidth && glTexture.height === source.pixelHeight;
  if (written.length === 0 || !allocated || webGLVersion !== WEBGL2) return false;
  // Pixi types the canvas as its own ICanvas and hands it to the GL calls the same way.
  const canvas = source.resource as TexImageSource;
  for (let i = 0; i < written.length; i += 4) {
    const x = written[i] ?? 0;
    const y = written[i + 1] ?? 0;
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
    const width = written[i + 2] ?? 0;
    const height = written[i + 3] ?? 0;
    gl.texSubImage2D(target, 0, x, y, width, height, glTexture.format, glTexture.type, canvas);
  }
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  return true;
}

/** A damage page the GPU already holds uploads its written tiles: a whole page is 4 MiB through the
 *  canvas for one tile's change. Anything else, and a page not yet allocated or forced whole, takes
 *  Pixi's image upload. */
export const DAMAGE_PAGE_UPLOADER: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source: TextureSource, glTexture, gl, webGLVersion, targetOverride, forceAllocation = false) {
    if (source instanceof DamagePageSource) {
      const target = targetOverride ?? glTexture.target;
      const partial = !forceAllocation && uploadWritten(source, glTexture, gl, webGLVersion, target);
      source.written.length = 0;
      if (partial) return;
    }
    glUploadImageResource.upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation);
  },
};

let uploaderRegistered = false;

/** Teach WebGL renderers the page's tile uploads; a renderer copies its uploaders when it is built, so
 *  this runs before any is. */
export function registerDamagePageUploader(): void {
  if (uploaderRegistered) return;
  uploaderRegistered = true;
  extensions.add({
    type: ExtensionType.TextureUploaderWebGL,
    name: UPLOAD_METHOD,
    ref: DAMAGE_PAGE_UPLOADER,
  });
}

/** Four shared pages at most (16 MiB RGBA). Damage leases colour tiles and demolition leases removal
 * masks in its own instance. Each owner returns slots at the end of its effect and handles saturation;
 * no per-house canvas. */
export class DamageAtlas {
  private readonly pages: DamagePage[] = [];
  private unavailable = false;

  allocate(width: number, height: number, original: Texture): DamageTile | null {
    const cols = Math.ceil((width + 2 * PAD) / CELL);
    const rows = Math.ceil((height + 2 * PAD) / CELL);
    if (cols > GRID || rows > GRID || width <= 0 || height <= 0 || this.unavailable) return null;
    for (let i = 0; i <= this.pages.length && i < MAX_PAGES; i++) {
      let page = this.pages[i];
      if (page === undefined) {
        const context = readable2dContext(SIDE, SIDE);
        if (context === null) {
          this.unavailable = true;
          return null;
        }
        page = {
          context,
          source: new DamagePageSource(context.canvas),
          occupied: new Uint8Array(GRID * GRID),
          dirty: false,
        };
        this.pages.push(page);
      }
      const cell = freeRectangle(page.occupied, cols, rows);
      if (cell === null) continue;
      const x = cell.x * CELL;
      const y = cell.y * CELL;
      fillCells(page.occupied, cell.x, cell.y, cols, rows, 1);
      const texture = new Texture({
        source: page.source,
        frame: new Rectangle(x + PAD, y + PAD, width, height),
      });
      if (isMagnifiedTexture(original)) {
        markPixelArtSource(page.source);
        markMagnifiedTexture(texture);
      }
      return { texture, page, x, y, cols, rows };
    }
    return null;
  }

  write(tile: DamageTile, data: Uint8ClampedArray, width: number, height: number): void {
    const ctx = tile.page.context;
    ctx.clearRect(tile.x, tile.y, tile.cols * CELL, tile.rows * CELL);
    const image = ctx.createImageData(width, height);
    image.data.set(data);
    ctx.putImageData(image, tile.x + PAD, tile.y + PAD);
    tile.page.source.markWritten(tile.x, tile.y, tile.cols * CELL, tile.rows * CELL);
    tile.page.dirty = true;
  }

  release(tile: DamageTile): void {
    fillCells(tile.page.occupied, tile.x / CELL, tile.y / CELL, tile.cols, tile.rows, 0);
    tile.texture.destroy();
  }

  flush(smooth: boolean): void {
    for (const page of this.pages) {
      page.source.scaleMode = smooth ? 'linear' : 'nearest';
      if (!page.dirty) continue;
      page.source.update();
      invalidateAlphaMask(page.source);
      page.dirty = false;
    }
  }

  destroy(): void {
    for (const page of this.pages) page.source.destroy();
    this.pages.length = 0;
  }
}

function freeRectangle(cells: Uint8Array, cols: number, rows: number): { x: number; y: number } | null {
  for (let y = 0; y <= GRID - rows; y++) {
    next: for (let x = 0; x <= GRID - cols; x++) {
      for (let dy = 0; dy < rows; dy++) {
        for (let dx = 0; dx < cols; dx++) if (cells[(y + dy) * GRID + x + dx] !== 0) continue next;
      }
      return { x, y };
    }
  }
  return null;
}

function fillCells(cells: Uint8Array, x: number, y: number, cols: number, rows: number, value: number): void {
  for (let dy = 0; dy < rows; dy++) cells.fill(value, (y + dy) * GRID + x, (y + dy) * GRID + x + cols);
}
