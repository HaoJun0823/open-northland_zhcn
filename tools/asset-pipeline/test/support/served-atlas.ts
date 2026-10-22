import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AtlasFrame } from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import { decodeGreyAlphaPng } from '@open-northland/formats/png';
import type { AtlasManifest } from '@open-northland/render';
import { colourIndexedSheet, decodeAtlasPalette, GREY_ALPHA_INDEXED } from '@open-northland/render/data';
import sharp from 'sharp';
import { ATLAS_MANIFEST_SUFFIX, BOBS_DIR } from '../../src/stages/content-tree.js';

/** A written `<stem>.atlas.json` with the packer's full frame records. */
export type ServedManifest = AtlasManifest & { readonly frames: readonly AtlasFrame[] };

/** Decodes a served sheet to its RGBA bytes, as packed. */
export async function decodeAtlasImage(bytes: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8Array(data) };
}

export async function readServedManifest(out: string, stem: string): Promise<ServedManifest> {
  return JSON.parse(await readFile(join(out, BOBS_DIR, `${stem}${ATLAS_MANIFEST_SUFFIX}`), 'utf8'));
}

/** The sheet a stem's manifest names, decoded and coloured through the stem's palette as the app does. */
export async function readServedSheet(out: string, stem: string): Promise<RgbaImage> {
  const { image, palette, imageEncoding } = await readServedManifest(out, stem);
  const bytes = await readFile(join(out, BOBS_DIR, image));
  if (palette === undefined) return decodeAtlasImage(bytes);
  if (imageEncoding !== 'index-coverage-png') throw new Error(`${stem}: paletted sheet without its encoding`);
  const { width, height, pixels } = await decodeGreyAlphaPng(bytes);
  const rgba = new Uint8Array(width * height * 4);
  colourIndexedSheet(pixels, GREY_ALPHA_INDEXED, decodeAtlasPalette(palette), rgba);
  return { width, height, rgba };
}
