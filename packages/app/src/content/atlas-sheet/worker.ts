import {
  colourIndexedSheet,
  decodeAtlasPalette,
  GREY_ALPHA_INDEXED,
} from '@open-northland/formats/atlas/paletted-sheet';
import { decodeGreyAlphaPng, type GreyAlphaImage } from '@open-northland/formats/png';
import type { PalettedSheetReply, PalettedSheetRequest } from './protocol.js';

const scope = globalThis as unknown as Pick<Worker, 'addEventListener' | 'postMessage'>;

/**
 * Decoded sheets kept for the next recolour of the same bob set, oldest first. The page routes every
 * stem of one sheet to one worker and asks for them together at boot, so a small budget catches them.
 */
const decoded = new Map<string, Promise<GreyAlphaImage>>();
/** The byte size of each settled entry of {@link decoded}. */
const decodedBytes = new Map<string, number>();
const DECODED_BUDGET_BYTES = 64 * 1024 * 1024;
/** After this long without a request the cache goes, so a finished boot holds no pixels. */
const IDLE_RELEASE_MS = 2000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * An `index-coverage-png` sheet decoded in JavaScript: a browser image decode would premultiply a covered
 * pixel's index away, and a canvas read is altered by some privacy settings and missing from older
 * Safari workers.
 */
async function decodeIndexed(url: string): Promise<GreyAlphaImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paletted sheet: ${url} answered HTTP ${res.status}`);
  return decodeGreyAlphaPng(new Uint8Array(await res.arrayBuffer()));
}

/** The decoded sheet at `url`, kept within {@link DECODED_BUDGET_BYTES}; a failure is not kept. */
function indexedSheet(url: string): Promise<GreyAlphaImage> {
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
      decodedBytes.set(url, sheet.pixels.length);
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
  const rgba = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  colourIndexedSheet(sheet.pixels, GREY_ALPHA_INDEXED, decodeAtlasPalette(request.palette), rgba);
  // The default leaves premultiplication to the browser; asking for it keeps every browser's page equal
  // to a Pixi-loaded RGBA sheet.
  const bitmap = await createImageBitmap(new ImageData(rgba, sheet.width, sheet.height), {
    premultiplyAlpha: 'premultiply',
  });
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
