import { CANVAS_READ_INDEXED, colourIndexedSheet, decodeAtlasPalette } from '@open-northland/render/data';

/** A decoded sheet is kept this long after its last request, so a boot's recolours of one bob set read
 *  it once. */
const KEEP_DECODED_MS = 2000;

const decoded = new Map<string, Promise<ImageData>>();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

async function readSheet(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paletted sheet: ${url} answered HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('paletted sheet: no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
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
 * under graded coverage the index read back can land on a neighbouring palette entry, and a browser
 * that alters canvas reads alters the colours. Fully covered pixels read exactly.
 */
export async function colourOnPage(url: string, palette: string): Promise<ImageBitmap> {
  const sheet = await sheetAt(url);
  const rgba = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  colourIndexedSheet(sheet.data, CANVAS_READ_INDEXED, decodeAtlasPalette(palette), rgba);
  return createImageBitmap(new ImageData(rgba, sheet.width, sheet.height), {
    premultiplyAlpha: 'premultiply',
  });
}
