import { basename, join } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '@open-northland/formats/atlas/index';
import type { Bmd } from '@open-northland/formats/bmd/index';
import type { RgbaImage } from '@open-northland/formats/image';
import type { AtlasManifest } from '@open-northland/render';
import { ATLAS_PALETTE_BYTES } from '@open-northland/render/data';
import { statIfExists, writeFileWithParents } from '../files.js';
import {
  atlasImageName,
  encodeAtlasImage,
  encodePalettedSheet,
  PALETTED_SHEET_EXTENSION,
} from './atlas-image.js';

// The output tree is served as static files, so each directory's name is the URL root the app fetches
// it at, and every file inside is lower-cased because the IR's references are.

/** Bob atlases plus the player and GUI colour LUTs. */
export const BOBS_DIR = 'bobs';
/** Ground texture pages and transition overlays. */
export const TEXTURES_DIR = 'textures';
/** The mod's `.wav` tree. */
export const SOUNDS_DIR = 'sounds';
/** Decoded map grids and their sidecars. */
export const MAPS_DIR = 'maps';

/** A stem's `<stem>.atlas.json`, the manifest the app reads first; it names the sheet files. */
export const ATLAS_MANIFEST_SUFFIX = '.atlas.json';

/**
 * Writes `value` as pretty-printed JSON (2-space indent, trailing newline) to `<outDir>/<relPath>`,
 * creating the parent directory.
 */
export async function writeJsonFile(outDir: string, relPath: string, value: unknown): Promise<void> {
  await writeFileWithParents(join(outDir, relPath), `${JSON.stringify(value, null, 2)}\n`);
}

/** The relative paths a bob atlas write produced (under `outDir`). */
export interface BobAtlasFiles {
  readonly image: string;
  readonly manifest: string;
}

/**
 * Writes `image` under {@link BOBS_DIR} at its content-addressed name and returns that name: a WebP,
 * or for a `paletted` sheet an `index-coverage-png`. A sheet already written this run is not encoded
 * again; the run clears the directory first, so a present file holds these bytes.
 */
async function writeAtlasImage(outDir: string, image: RgbaImage, paletted = false): Promise<string> {
  const name = paletted ? atlasImageName(image, PALETTED_SHEET_EXTENSION) : atlasImageName(image);
  const path = join(outDir, BOBS_DIR, name);
  if ((await statIfExists(path)) === undefined)
    await writeFileWithParents(path, await (paletted ? encodePalettedSheet : encodeAtlasImage)(image));
  return name;
}

/**
 * One recolour of a bob set that other recolours share: the indexed atlas
 * (`packIndexedBobAtlas`, with the alpha options the RGB bake would take) and this stem's palette. It
 * is served as the shared indexed sheet (an `index-coverage-png`) plus the palette, which the app
 * colours at load, so the bob set's recolours cost one sheet.
 */
export interface PalettedBobAtlas {
  readonly indexed: BobAtlas;
  readonly palette: Uint8Array;
}

/**
 * Writes a packed bob atlas's sheet, and a `'build-time'` bake's time sheet, under {@link BOBS_DIR},
 * then the `<stem>.atlas.json` that names them. A {@link PalettedBobAtlas} writes its indexed sheet
 * and puts the palette in the manifest.
 */
async function writeBobAtlas(
  outDir: string,
  stem: string,
  atlas: BobAtlas | PalettedBobAtlas,
): Promise<BobAtlasFiles> {
  const paletted = 'indexed' in atlas;
  if (paletted && atlas.palette.length !== ATLAS_PALETTE_BYTES) {
    throw new Error(
      `atlas: ${stem} palette has ${atlas.palette.length} bytes, expected ${ATLAS_PALETTE_BYTES}`,
    );
  }
  const packed = paletted ? atlas.indexed : atlas;
  const image = await writeAtlasImage(outDir, packed.image, paletted);
  const buildImage =
    packed.timeImage === undefined ? undefined : await writeAtlasImage(outDir, packed.timeImage);
  const served = {
    ...packed.manifest,
    image,
    ...(paletted
      ? {
          palette: Buffer.from(atlas.palette).toString('base64'),
          imageEncoding: 'index-coverage-png' as const,
        }
      : {}),
    ...(buildImage === undefined ? {} : { buildImage }),
  } satisfies AtlasManifest;
  const manifest = `${BOBS_DIR}/${stem}${ATLAS_MANIFEST_SUFFIX}`;
  await writeJsonFile(outDir, manifest, served);
  return { image: `${BOBS_DIR}/${image}`, manifest };
}

/** The two `loadLayer` stems {@link emitIndexedAndPreviewAtlas} wrote, plus the atlas frame count. */
export interface IndexedAtlasStems {
  /** `<keyStem>.indexed` - the recolourable indexed atlas (palette index in red, coverage in green). */
  readonly indexedStem: string;
  /** `<keyStem>.<previewSuffix>` - the RGBA atlas coloured through the preview palette. */
  readonly previewStem: string;
  readonly frames: number;
}

/** The suffix of an indexed atlas (palette index in red, coverage in green, opaque), which the app loads
 *  by name. */
export const INDEXED_ATLAS_SUFFIX = 'indexed';

/**
 * Packs a decoded bob container into an indexed atlas the app recolours at draw time plus an RGBA
 * preview coloured through `previewPalette`, which the DOM shows as it is (the goods' pile icons),
 * written under {@link BOBS_DIR} as `<keyStem>.indexed` and `<keyStem>.<previewSuffix>` (the naming the
 * app-side loaders mirror).
 */
export async function emitIndexedAndPreviewAtlas(
  outDir: string,
  keyStem: string,
  bmd: Bmd,
  previewSuffix: string,
  previewPalette: Uint8Array,
): Promise<IndexedAtlasStems> {
  const indexed = packIndexedBobAtlas(bmd);
  const indexedStem = `${keyStem}.${INDEXED_ATLAS_SUFFIX}`;
  const previewStem = `${keyStem}.${previewSuffix}`;
  await writeBobAtlas(outDir, indexedStem, indexed);
  await writeBobAtlas(outDir, previewStem, packBobAtlas(bmd, previewPalette));
  return { indexedStem, previewStem, frames: indexed.manifest.frames.length };
}

/**
 * The flat {@link BOBS_DIR} stem a source `.bmd`'s derived atlas is served at: the lower-cased basename
 * plus `.<suffix>`. The app addresses every atlas by basename under one flat `/bobs/` route, so a bob in
 * a subdirectory or a mixed-case layer must still land at exactly this name. `suffix` (a palette slug,
 * or `indexed`/`shadow`) keeps recolours of one shared body bob apart.
 */
export function bobAtlasStem(bmdRel: string, suffix: string): string {
  const name = basename(bmdRel).replace(/\.bmd$/i, '');
  return `${name.toLowerCase()}.${suffix}`;
}

/** Writes a packed atlas for the source `.bmd` at `bmdRel` under its {@link bobAtlasStem}. */
export async function writeSourceBobAtlas(
  outDir: string,
  bmdRel: string,
  suffix: string,
  atlas: BobAtlas | PalettedBobAtlas,
): Promise<BobAtlasFiles> {
  return writeBobAtlas(outDir, bobAtlasStem(bmdRel, suffix), atlas);
}

/**
 * Rejects distinct `.bmd` sources whose atlases would claim one {@link bobAtlasStem}. The served
 * namespace is flat, so `bobs/nowe/mur.bmd` and `bobs/mur.bmd` would silently clobber each other; the
 * owned corpus has no such pair. Pass one suffix family at a time, since across families the names
 * cannot meet. Every colliding pair is reported at once because a rerun costs a full conversion.
 */
export function assertDistinctBobBasenames(bmdRefs: Iterable<string>): void {
  const byBasename = new Map<string, string>();
  const collisions: string[] = [];
  for (const ref of bmdRefs) {
    const base = basename(ref).toLowerCase();
    const first = byBasename.get(base);
    if (first === undefined) byBasename.set(base, ref);
    else if (first !== ref) collisions.push(`"${first}" and "${ref}" -> ${bobAtlasStem(ref, '<suffix>')}`);
  }
  if (collisions.length > 0) {
    throw new Error(
      'bob basename collision - the served atlas namespace is flat, so each of these pairs would ' +
        `claim one name: ${collisions.join('; ')}. Rename one .bmd of each pair and re-run`,
    );
  }
}
