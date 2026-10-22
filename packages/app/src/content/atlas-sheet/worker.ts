import { colourIndexedSheet, decodeAtlasPalette } from '@open-northland/render/data';
import type { PalettedSheetReply, PalettedSheetRequest } from './protocol.js';

const scope = globalThis as unknown as Pick<Worker, 'addEventListener' | 'postMessage'>;

/**
 * Decoded sheets kept for the next recolour of the same bob set, oldest first. The page routes every
 * stem of one sheet to one worker and asks for them together at boot, so a small budget catches them.
 */
const decoded = new Map<string, Promise<ImageData>>();
/** The byte size of each settled entry of {@link decoded}. */
const decodedBytes = new Map<string, number>();
const DECODED_BUDGET_BYTES = 64 * 1024 * 1024;
/** After this long without a request the cache goes, so a finished boot holds no pixels. */
const IDLE_RELEASE_MS = 2000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** One 2d scratch canvas, sized per read and shrunk after; the rule is no canvas per image kept alive. */
let scratch: OffscreenCanvas | undefined;

/**
 * The pixels of a decoded indexed sheet. The sheet is opaque, so the 2d canvas's premultiplied store
 * keeps every byte, and colour conversion is off for an untagged image either way.
 */
function readPixels(bitmap: ImageBitmap): ImageData {
  scratch ??= new OffscreenCanvas(1, 1);
  scratch.width = bitmap.width;
  scratch.height = bitmap.height;
  try {
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('paletted sheet: no 2d context in the worker');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    scratch.width = 1;
    scratch.height = 1;
  }
}

async function decodeIndexed(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paletted sheet: ${url} answered HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
  try {
    return readPixels(bitmap);
  } finally {
    bitmap.close();
  }
}

/** The decoded sheet at `url`, kept within {@link DECODED_BUDGET_BYTES}; a failure is not kept. */
function indexedSheet(url: string): Promise<ImageData> {
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
      decodedBytes.set(url, sheet.data.length);
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

/** Requests not answered yet; the cache is not released under one. */
let inFlight = 0;

function releaseIdle(): void {
  if (inFlight > 0) {
    idleTimer = setTimeout(releaseIdle, IDLE_RELEASE_MS);
    return;
  }
  decoded.clear();
  decodedBytes.clear();
}

async function serve(request: PalettedSheetRequest): Promise<PalettedSheetReply> {
  const sheet = await indexedSheet(request.url);
  const rgba = new Uint8ClampedArray(sheet.data.length);
  colourIndexedSheet(sheet.data, decodeAtlasPalette(request.palette), rgba);
  const bitmap = await createImageBitmap(new ImageData(rgba, sheet.width, sheet.height));
  return { id: request.id, bitmap };
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
