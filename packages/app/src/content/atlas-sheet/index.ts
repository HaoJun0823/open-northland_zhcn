import { atlasSourceFromBitmap, loadAtlasSource, type TextureSource } from '@open-northland/render';
import { atlasImagePath, contentUrl } from '../url.js';
import type { PalettedSheetForm, PalettedSheetReply, PalettedSheetRequest } from './protocol.js';

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
 * Workers colouring paletted sheets. Measured on a 1024x6037 sheet (headless Chromium, software GL,
 * a loaded M2 Pro): about 40 ms to decode, 40 ms to read back, 22 ms to colour and 11 ms to make the
 * bitmap, far too long for the main thread. A few threads keep a boot's ~200 recolours from queueing
 * behind each other; each sheet's stems go to one worker, whose cache then decodes the sheet once.
 */
const MAX_WORKERS = 3;

const spawnWorker = (): PalettedSheetWorker =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface Pending {
  readonly resolve: (reply: PalettedSheetReply) => void;
  readonly reject: (err: Error) => void;
}

/** A pool of colouring workers, spawned on first use. */
export function createPalettedSheetClient(
  spawn: () => PalettedSheetWorker = spawnWorker,
  size = Math.max(1, Math.min(MAX_WORKERS, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
): (url: string, palette: string, form: PalettedSheetForm) => Promise<PalettedSheetReply> {
  const workers: PalettedSheetWorker[] = [];
  const pending = new Map<number, Pending>();
  let nextId = 0;
  const workerFor = (url: string, form: PalettedSheetForm): PalettedSheetWorker => {
    let hash = 0;
    for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
    // The DOM's few small sheets get a worker of their own, so a HUD icon does not wait for the map's pages.
    const slot = form === 'blob' ? size : hash % size;
    let worker = workers[slot];
    if (worker === undefined) {
      worker = spawn();
      worker.addEventListener('message', (event) => {
        pending.get(event.data.id)?.resolve(event.data);
        pending.delete(event.data.id);
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
  return (url, palette, form) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      workerFor(url, form).postMessage({ id, url, palette, form });
    });
}

let colour: ReturnType<typeof createPalettedSheetClient> | undefined;

async function palettedSheet(image: string, palette: string, form: 'bitmap'): Promise<ImageBitmap>;
async function palettedSheet(image: string, palette: string, form: 'blob'): Promise<Blob>;
async function palettedSheet(
  image: string,
  palette: string,
  form: PalettedSheetForm,
): Promise<ImageBitmap | Blob> {
  colour ??= createPalettedSheetClient();
  // A worker resolves a URL against its own script, so it gets the page's absolute one.
  const url = new URL(contentUrl(atlasImagePath(image)), globalThis.location.href).href;
  const reply = await colour(url, palette, form);
  if ('error' in reply) throw new Error(reply.error);
  return 'bitmap' in reply ? reply.bitmap : reply.blob;
}

/**
 * A stem's atlas page for the renderer. A paletted stem's indexed sheet is coloured off the main
 * thread into the RGBA page its own sheet used to be, so the renderer sees the same pixels either way.
 */
export async function loadAtlasSheet(sheet: AtlasSheetRef, straight: boolean): Promise<TextureSource> {
  if (sheet.palette === undefined) {
    return loadAtlasSource(
      contentUrl(atlasImagePath(sheet.image)),
      'nearest',
      straight ? 'straight' : 'premultiplied',
    );
  }
  return atlasSourceFromBitmap(await palettedSheet(sheet.image, sheet.palette, 'bitmap'));
}

/** Coloured image files by sheet and palette, kept for the page's life: the DOM shows a few. */
const sheetUrls = new Map<string, Promise<string>>();

/** A URL the DOM can show a stem's sheet from (a CSS background, an `<img>`). */
export function atlasSheetUrl(sheet: AtlasSheetRef): Promise<string> {
  const { image, palette } = sheet;
  if (palette === undefined) return Promise.resolve(contentUrl(atlasImagePath(image)));
  const key = `${image} ${palette}`;
  let url = sheetUrls.get(key);
  if (url === undefined) {
    url = palettedSheet(image, palette, 'blob').then((blob) => URL.createObjectURL(blob));
    url.catch(() => sheetUrls.delete(key));
    sheetUrls.set(key, url);
  }
  return url;
}
