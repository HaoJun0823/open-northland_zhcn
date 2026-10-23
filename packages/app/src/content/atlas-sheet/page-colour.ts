import {
  CANVAS_READ_INDEXED,
  colourIndexedSheet,
  decodeAtlasPalette,
} from '@open-northland/formats/atlas/paletted-sheet';
import { readImageData } from '../net.js';

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
