import {
  CanvasSource,
  ExtensionType,
  extensions,
  type GLTextureUploader,
  type GlRenderingContext,
  type GlTexture,
  glUploadImageResource,
  type TextureSource,
} from 'pixi.js';

const UPLOAD_METHOD = 'written-page';
/** Pixi's uploaders take WebGL 2 on this version number. */
const WEBGL2 = 2;

/** A canvas page that remembers the rectangles written since its last upload, so an upload to a texture
 *  the GPU already holds copies those alone instead of the whole page. */
export class WrittenPageSource extends CanvasSource {
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
  source: WrittenPageSource,
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

/** A page the GPU already holds uploads its written rectangles: a whole page goes through the canvas
 *  for one small bake's change. Anything else, and a page not yet allocated or forced whole, takes
 *  Pixi's image upload. */
export const WRITTEN_PAGE_UPLOADER: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source: TextureSource, glTexture, gl, webGLVersion, targetOverride, forceAllocation = false) {
    if (source instanceof WrittenPageSource) {
      const target = targetOverride ?? glTexture.target;
      const partial = !forceAllocation && uploadWritten(source, glTexture, gl, webGLVersion, target);
      source.written.length = 0;
      if (partial) return;
    }
    glUploadImageResource.upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation);
  },
};

let uploaderRegistered = false;

/** Teach WebGL renderers the pages' rectangle uploads; a renderer copies its uploaders when it is built,
 *  so this runs before any is. */
export function registerWrittenPageUploader(): void {
  if (uploaderRegistered) return;
  uploaderRegistered = true;
  extensions.add({
    type: ExtensionType.TextureUploaderWebGL,
    name: UPLOAD_METHOD,
    ref: WRITTEN_PAGE_UPLOADER,
  });
}
