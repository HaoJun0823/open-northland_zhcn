import { colourIndexedSheet, decodeAtlasPalette } from '@open-northland/render/data';
import type { PalettedSheetReply, PalettedSheetRequest } from './protocol.js';

const scope = globalThis as unknown as Pick<Worker, 'addEventListener' | 'postMessage'>;

const RGBA = 4;

/** Straight RGBA of a decoded indexed sheet. */
interface IndexedPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/**
 * Decoded sheets kept for the next recolour of the same bob set, oldest first. The page routes every
 * stem of one sheet to one worker and asks for them together at boot, so a small budget catches them.
 */
const decoded = new Map<string, Promise<IndexedPixels>>();
/** The byte size of each settled entry of {@link decoded}. */
const decodedBytes = new Map<string, number>();
const DECODED_BUDGET_BYTES = 64 * 1024 * 1024;
/** After this long without a request the cache and the context go, so a finished boot holds neither. */
const IDLE_RELEASE_MS = 2000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

let gl: WebGLRenderingContext | null | undefined;

/**
 * Reads a straight-alpha bitmap back byte-exact. A 2d canvas stores premultiplied pixels, which would
 * round the palette index under graded coverage; a texture upload of a `premultiplyAlpha: 'none'`
 * bitmap keeps the bytes, as the renderer's own indexed sheets rely on. A sheet taller than the
 * context's texture limit is read in bands cropped from the bitmap.
 */
async function readStraightPixels(bitmap: ImageBitmap): Promise<Uint8Array> {
  gl ??= new OffscreenCanvas(1, 1).getContext('webgl', { antialias: false, depth: false, stencil: false });
  if (gl === null) throw new Error('paletted sheet: no WebGL context in the worker');
  const { width, height } = bitmap;
  const limit = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[1] ?? 0,
  );
  if (width > limit) throw new Error(`paletted sheet: a ${width} px wide sheet exceeds ${limit} px`);
  const pixels = new Uint8Array(width * height * RGBA);
  const context = gl;
  for (let top = 0; top < height; top += limit) {
    const rows = Math.min(limit, height - top);
    const band =
      top === 0 && rows === height
        ? bitmap
        : await createImageBitmap(bitmap, 0, top, width, rows, { premultiplyAlpha: 'none' });
    try {
      readBand(context, band, pixels.subarray(top * width * RGBA, (top + rows) * width * RGBA));
    } finally {
      if (band !== bitmap) band.close();
    }
  }
  if (context.isContextLost()) throw new Error('paletted sheet: the WebGL context was lost during a read');
  return pixels;
}

function readBand(gl: WebGLRenderingContext, band: ImageBitmap, into: Uint8Array): void {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, band);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`paletted sheet: a ${band.width}x${band.height} band cannot be read back`);
    }
    gl.readPixels(0, 0, band.width, band.height, gl.RGBA, gl.UNSIGNED_BYTE, into);
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  }
}

async function decodeIndexed(url: string): Promise<IndexedPixels> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paletted sheet: ${url} answered HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    return { width: bitmap.width, height: bitmap.height, rgba: await readStraightPixels(bitmap) };
  } finally {
    bitmap.close();
  }
}

/** The decoded sheet at `url`, kept within {@link DECODED_BUDGET_BYTES}; a failure is not kept. */
function indexedSheet(url: string): Promise<IndexedPixels> {
  const kept = decoded.get(url);
  if (kept !== undefined) {
    decoded.delete(url);
    decoded.set(url, kept);
    return kept;
  }
  const pending = decodeIndexed(url);
  decoded.set(url, pending);
  pending.then(
    (sheet) => {
      if (decoded.get(url) !== pending) return;
      decodedBytes.set(url, sheet.rgba.length);
      evictOverBudget();
    },
    () => decoded.delete(url),
  );
  return pending;
}

/** Drops the least recently asked decoded sheets until the kept ones fit the budget. */
function evictOverBudget(): void {
  let total = 0;
  for (const bytes of decodedBytes.values()) total += bytes;
  for (const url of decoded.keys()) {
    if (total <= DECODED_BUDGET_BYTES) return;
    const bytes = decodedBytes.get(url);
    if (bytes === undefined) continue;
    decoded.delete(url);
    decodedBytes.delete(url);
    total -= bytes;
  }
}

/** Requests not answered yet; the context is not released under one. */
let inFlight = 0;

/** Frees the kept pixels and the WebGL context once the page stops asking. */
function releaseIdle(): void {
  if (inFlight > 0) {
    idleTimer = setTimeout(releaseIdle, IDLE_RELEASE_MS);
    return;
  }
  decoded.clear();
  decodedBytes.clear();
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  gl = undefined;
}

/** One 2d scratch canvas re-sized per image file; the rule is no canvas per image kept alive. */
let scratch: OffscreenCanvas | undefined;

async function serve(request: PalettedSheetRequest): Promise<PalettedSheetReply> {
  const sheet = await indexedSheet(request.url);
  const rgba = new Uint8ClampedArray(sheet.rgba.length);
  colourIndexedSheet(sheet.rgba, decodeAtlasPalette(request.palette), rgba);
  const image = new ImageData(rgba, sheet.width, sheet.height);
  if (request.form === 'bitmap') return { id: request.id, bitmap: await createImageBitmap(image) };
  scratch ??= new OffscreenCanvas(1, 1);
  scratch.width = sheet.width;
  scratch.height = sheet.height;
  const ctx = scratch.getContext('2d');
  if (ctx === null) throw new Error('paletted sheet: no 2d context in the worker');
  ctx.putImageData(image, 0, 0);
  const blob = await scratch.convertToBlob({ type: 'image/png' });
  scratch.width = 1;
  scratch.height = 1;
  return { id: request.id, blob };
}

scope.addEventListener('message', (event: MessageEvent<PalettedSheetRequest>) => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseIdle, IDLE_RELEASE_MS);
  const request = event.data;
  inFlight++;
  serve(request)
    .finally(() => inFlight--)
    .then(
      (reply) => scope.postMessage(reply, 'bitmap' in reply ? [reply.bitmap] : []),
      (err: unknown) =>
        scope.postMessage({ id: request.id, error: String(err) } satisfies PalettedSheetReply),
    );
});
