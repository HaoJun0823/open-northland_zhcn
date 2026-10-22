import {
  type AtlasSheetLayout,
  atlasSourceFromBitmap,
  loadAtlasSource,
  type TextureSource,
} from '@open-northland/render';
import { diag } from '../../diag/log.js';
import { atlasImagePath, contentUrl } from '../url.js';
import type { PalettedSheetReply, PalettedSheetRequest } from './protocol.js';

/** The manifest fields that say which sheet a stem draws from and how it is coloured. */
export interface AtlasSheetRef {
  readonly image: string;
  /** Base64 RGB palette: `image` is an indexed sheet shared by the bob set's recolours. */
  readonly palette?: string;
}

/** The part of a `Worker` the client uses, so a test can stand in for the thread. */
export interface PalettedSheetWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent<PalettedSheetReply>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  postMessage(request: PalettedSheetRequest): void;
}

/**
 * Workers colouring paletted sheets, far too slow for the main thread at a boot's ~200 recolours. A
 * few threads keep them from queueing behind each other; each sheet's stems go to one worker, whose
 * cache then decodes the sheet once.
 */
const MAX_WORKERS = 3;

const spawnWorker = (): PalettedSheetWorker =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface Pending {
  readonly resolve: (bitmap: ImageBitmap) => void;
  readonly reject: (err: Error) => void;
}

/** A pool of colouring workers, spawned on first use: the coloured page of an indexed sheet. */
export function createPalettedSheetClient(
  spawn: () => PalettedSheetWorker = spawnWorker,
  size = Math.max(1, Math.min(MAX_WORKERS, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
): (url: string, palette: string) => Promise<ImageBitmap> {
  const workers: PalettedSheetWorker[] = [];
  const pending = new Map<number, Pending>();
  let nextId = 0;
  const workerFor = (url: string): PalettedSheetWorker => {
    let hash = 0;
    for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
    const slot = hash % size;
    let worker = workers[slot];
    if (worker === undefined) {
      worker = spawn();
      worker.addEventListener('message', (event) => {
        const reply = event.data;
        const waiting = pending.get(reply.id);
        pending.delete(reply.id);
        if ('error' in reply) waiting?.reject(new Error(reply.error));
        else waiting?.resolve(reply.bitmap);
      });
      worker.addEventListener('error', (event) => {
        for (const { reject } of pending.values())
          reject(new Error(`paletted sheet worker: ${event.message}`));
        pending.clear();
      });
      workers[slot] = worker;
    }
    return worker;
  };
  return (url, palette) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      workerFor(url).postMessage({ id, url, palette });
    });
}

let colour: ReturnType<typeof createPalettedSheetClient> | undefined;

/** The coloured page of a paletted stem; rejects when the sheet cannot be fetched or decoded. */
export function palettedSheetBitmap(image: string, palette: string): Promise<ImageBitmap> {
  colour ??= createPalettedSheetClient();
  // A worker resolves a URL against its own script, so it gets the page's absolute one.
  return colour(new URL(contentUrl(atlasImagePath(image)), globalThis.location.href).href, palette);
}

/** Sheets whose failed colouring was reported; one warning per sheet and page. */
const warnedSheets = new Set<string>();

/**
 * A stem's atlas page for the renderer. A paletted stem's indexed sheet is coloured off the main thread
 * into the RGBA page its own sheet used to be, so the renderer sees the same pixels either way. A
 * colouring that fails resolves `undefined`, warned once per sheet, like a missing optional texture.
 */
export async function loadAtlasSheet(
  sheet: AtlasSheetRef,
  layout: AtlasSheetLayout,
): Promise<TextureSource | undefined> {
  if (sheet.palette === undefined) {
    return loadAtlasSource(contentUrl(atlasImagePath(sheet.image)), 'nearest', layout);
  }
  try {
    return atlasSourceFromBitmap(await palettedSheetBitmap(sheet.image, sheet.palette));
  } catch (err) {
    if (!warnedSheets.has(sheet.image)) {
      warnedSheets.add(sheet.image);
      diag.warn('content', `atlas sheet ${sheet.image} could not be coloured; its stems draw nothing`, err);
    }
    return undefined;
  }
}

/**
 * The URL a DOM picture (an `<img>`, a CSS background) shows a stem's sheet from, or null for a
 * paletted sheet, whose pixels are palette indices: the pipeline serves the sheets the DOM reads in
 * colour.
 */
export function pictureSheetUrl(sheet: AtlasSheetRef): string | null {
  if (sheet.palette !== undefined) {
    if (!warnedSheets.has(sheet.image)) {
      warnedSheets.add(sheet.image);
      diag.warn('content', `atlas sheet ${sheet.image} is paletted, so no picture shows it`);
    }
    return null;
  }
  return contentUrl(atlasImagePath(sheet.image));
}
