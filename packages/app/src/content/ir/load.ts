import { type BobAtlasGeometry, decodeAtlasFrames } from '@open-northland/data';
import {
  type AtlasSheetLayout,
  type BuildTimeSheet,
  indexAtlasFrames,
  type SpriteAtlas,
  type SpriteLayer,
} from '@open-northland/render';
import { Texture, type TextureSource } from 'pixi.js';
import { loadAtlasSheet } from '../atlas-sheet/index.js';
import { loadServedBobAtlas } from '../bob-atlases.js';
import { fetchImageData, fetchJsonOrNull } from '../net.js';
import { atlasImagePath } from '../url.js';
import { BODY_IMAGELIB, type BobSeqRow, type ContentIr } from './rows.js';

/**
 * The decoded atlas isn't served (the pipeline hasn't run, or `content/` is empty). The sheet loaders catch
 * only this to degrade to the synthetic markers; any other error propagates.
 */
export class MissingAtlasError extends Error {}

/** Indexed sheets (the pipeline emits every one as `<stem>.indexed`): palette index in red, coverage in
 *  green. */
function isIndexedStem(stem: string): boolean {
  return stem.endsWith('.indexed');
}

/** Every decoded atlas body in flight or settled, by served stem and sheet layout. */
const layerBodies = new Map<string, Promise<SpriteLayer>>();

/** Layers whose sheet could not be coloured: they draw nothing and the next caller tries again. */
const degradedLayers = new WeakSet<SpriteLayer>();

/** Indexed frames by geometry, then by the page they cut. The renderer keys its texture views by frame
 *  object, so a frame belongs to one page: palette twins share a geometry but each colours its own page,
 *  and stems sharing a page (one RGB sheet) share frames. */
const atlasByGeometry = new WeakMap<BobAtlasGeometry, WeakMap<TextureSource, SpriteAtlas>>();

function spriteAtlasOf(geometry: BobAtlasGeometry, source: TextureSource): SpriteAtlas {
  let byPage = atlasByGeometry.get(geometry);
  if (byPage === undefined) {
    byPage = new WeakMap();
    atlasByGeometry.set(geometry, byPage);
  }
  let atlas = byPage.get(source);
  if (atlas === undefined) {
    atlas = indexAtlasFrames(geometry.width, geometry.height, decodeAtlasFrames(geometry));
    byPage.set(source, atlas);
  }
  return atlas;
}

/**
 * One decoded atlas body (the stem's entry in `bobs/atlases.json` and the sheet it names, coloured
 * through the stem's palette when it names one). A sheet that cannot be coloured leaves an empty page,
 * so the stem draws nothing. A stem with a `buildImage` also reads that time sheet CPU-side for the
 * per-pixel construction-reveal thresholds, degrading to the crop reveal when unreadable.
 */
async function fetchLayerBody(stem: string, layout: AtlasSheetLayout): Promise<SpriteLayer> {
  const served = await loadServedBobAtlas(stem);
  if (served === null) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not served. Run \`npm run build:content\` to populate content/.`,
    );
  }
  const { sheet, geometry } = served;
  const [source, times] = await Promise.all([
    loadAtlasSheet(sheet, layout),
    sheet.buildImage === undefined
      ? Promise.resolve(undefined)
      : loadBuildTimeSheet(atlasImagePath(sheet.buildImage)),
  ]);
  const page = source ?? Texture.EMPTY.source;
  const layer = {
    atlas: spriteAtlasOf(geometry, page),
    source: page,
    ...(times !== undefined ? { times } : {}),
  };
  if (source === undefined) degradedLayers.add(layer);
  return layer;
}

/**
 * `fetchLayerBody` memoized per stem and layout. Handing out the same instance is safe: `atlas.frames` is a
 * `ReadonlyMap`, nothing writes `times.values` once it is filled, and no consumer destroys an atlas page's
 * `TextureSource`.
 */
function loadLayerBody(
  stem: string,
  layout: AtlasSheetLayout = isIndexedStem(stem) ? 'indexed' : 'rgba',
): Promise<SpriteLayer> {
  const key = `${layout}:${stem}`;
  const cached = layerBodies.get(key);
  if (cached !== undefined) return cached;
  const pending = fetchLayerBody(stem, layout);
  // Memoize only success, so a transient failure does not pin this stem to the fallback for the page's life.
  const forget = (): void => {
    if (layerBodies.get(key) === pending) layerBodies.delete(key);
  };
  pending.then((layer) => {
    if (degradedLayers.has(layer)) forget();
  }, forget);
  layerBodies.set(key, pending);
  return pending;
}

/**
 * One decoded atlas layer, optionally carrying the cast-shadow twin named by `shadowStem` (the pipeline's
 * `<shadow-bmd-stem>.shadow` atlas). A missing shadow degrades to a shadow-less layer rather than failing
 * the body.
 */
export async function loadLayer(stem: string, shadowStem?: string): Promise<SpriteLayer> {
  const shadowLoad =
    shadowStem === undefined
      ? undefined
      : loadLayerBody(shadowStem).catch((err: unknown) => {
          if (err instanceof MissingAtlasError) return undefined;
          throw err;
        });
  // Keep a shadow rejection from surfacing as unhandled while the body await is pending; the body's own
  // failure stays the one a caller sees.
  shadowLoad?.catch(() => undefined);
  const body = await loadLayerBody(stem);
  const shadow = await shadowLoad;
  return shadow === undefined ? body : { ...body, shadow };
}

/** A displacement effect's layer (a shore wave's `<stem>.indexed`): values in red, the written mask in
 *  alpha, loaded straight. */
export function loadDisplacementLayer(stem: string): Promise<SpriteLayer> {
  return loadLayerBody(stem, 'displacement');
}

/** Fetch a build-time sheet and keep its R channel (the 0–255 thresholds) CPU-side, or `undefined`
 *  when absent/unreadable. */
async function loadBuildTimeSheet(url: string): Promise<BuildTimeSheet | undefined> {
  const img = await fetchImageData(url);
  if (img === null) return undefined;
  const values = new Uint8Array(img.width * img.height);
  for (let i = 0; i < values.length; i++) values[i] = img.data[i * 4] ?? 0;
  return { width: img.width, height: img.height, values };
}

let contentIrPromise: Promise<unknown> | null = null;

/**
 * Fetch and parse the served `content/ir.json` once per page - memoized, because it is multi-MB and every
 * domain reads its lanes from the same bytes. Returns `null` when absent or unreadable.
 */
export function loadIrRaw(): Promise<unknown> {
  contentIrPromise ??= fetchJsonOrNull<unknown>('/ir.json').then((raw) => {
    // Memoize only success, so the next consumer retries after a transient boot-time fetch failure.
    if (raw === null) contentIrPromise = null;
    return raw;
  });
  return contentIrPromise;
}

/**
 * The graphics/atlas view of the served IR, cast at the I/O boundary. `null` when the document is absent;
 * each consumer then falls back per-lane.
 */
export async function loadIr(): Promise<ContentIr | null> {
  const raw = await loadIrRaw();
  return raw === null ? null : (raw as ContentIr);
}

/**
 * Every `[bobseq]` of one body bob set, in file order - the frame ranges only, not the atlas image.
 * Returns `[]` when the IR is absent.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * A gallery character's layers: one body atlas plus N head atlases, given already-resolved served stems
 * (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`). An absent body throws
 * `MissingAtlasError`; a missing head degrades to `undefined` in its `heads` slot, which keeps stem order.
 * `bodyShadowStem` attaches the body's authored silhouette twin; no head bob has one.
 */
export async function loadGalleryLayers(
  bodyStem: string,
  headStems: readonly string[],
  bodyShadowStem?: string,
): Promise<{ body: SpriteLayer; heads: (SpriteLayer | undefined)[] }> {
  const bodyPromise = loadLayer(bodyStem, bodyShadowStem);
  const headsPromise = Promise.all(
    headStems.map((s) =>
      loadLayer(s).catch((err: unknown) => {
        if (err instanceof MissingAtlasError) return undefined;
        throw err;
      }),
    ),
  );
  const [body, heads] = await Promise.all([bodyPromise, headsPromise]);
  return { body, heads };
}
