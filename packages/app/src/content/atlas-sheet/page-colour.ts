import {
  CANVAS_READ_INDEXED,
  colourIndexedSheet,
  decodeAtlasPalette,
} from '@open-northland/formats/atlas/paletted-sheet';
import { readImageData } from '../net.js';
import type { IndexedSheetPixels } from './protocol.js';

/** Bytes per texel of a sheet's own pixels: palette index, coverage. */
const INDEX_COVERAGE_BYTES = 2;

/** A decoded sheet is kept this long after its last request, so a boot's recolours of one bob set read
 *  it once. */
const KEEP_DECODED_MS = 2000;

const decoded = new Map<string, Promise<ImageData>>();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

async function readSheet(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paletted sheet: ${url} answered HTTP ${res.status}`);
  return readImageData(await res.blob(), { colorSpaceConversion: 'none' });
}

function sheetAt(url: string): Promise<ImageData> {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => decoded.clear(), KEEP_DECODED_MS);
  let sheet = decoded.get(url);
  if (sheet === undefined) {
    sheet = readSheet(url);
    decoded.set(url, sheet);
    sheet.catch(() => decoded.delete(url));
  }
  return sheet;
}

/**
 * Colours a paletted sheet on the page, for a browser whose workers cannot decode one (no
 * `DecompressionStream`, Safari before 16.4). Approximation: the canvas stores premultiplied pixels, so
 * only fully covered pixels read their index back exactly; the error grows as coverage falls (about
 * 255 / (2 * alpha) index steps, any palette entry at the faintest coverage), and a browser that alters
 * canvas reads alters the colours.
 */
export async function colourOnPage(url: string, palette: string): Promise<ImageBitmap> {
  const sheet = await sheetAt(url);
  const rgba = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  colourIndexedSheet(sheet.data, CANVAS_READ_INDEXED, decodeAtlasPalette(palette), rgba);
  return createImageBitmap(new ImageData(rgba, sheet.width, sheet.height), {
    premultiplyAlpha: 'premultiply',
  });
}

/**
 * A paletted sheet's index and coverage bytes read on the page, for a browser whose workers cannot
 * decode one. The same approximation as {@link colourOnPage}: below full coverage the index read back
 * through the canvas drifts.
 */
export async function indexedOnPage(url: string): Promise<IndexedSheetPixels> {
  const sheet = await sheetAt(url);
  const texels = sheet.width * sheet.height;
  const pixels = new Uint8Array(texels * INDEX_COVERAGE_BYTES);
  const { bytesPerPixel, coverage } = CANVAS_READ_INDEXED;
  for (let t = 0, i = 0, o = 0; t < texels; t++, i += bytesPerPixel, o += INDEX_COVERAGE_BYTES) {
    pixels[o] = sheet.data[i] ?? 0;
    pixels[o + 1] = sheet.data[i + coverage] ?? 0;
  }
  return { pixels, width: sheet.width, height: sheet.height };
}
