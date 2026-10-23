import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOB_ATLASES_PATH, BobAtlasSet, bobAtlasManifest } from '@open-northland/data';
import {
  colourIndexedSheet,
  decodeAtlasPalette,
  GREY_ALPHA_INDEXED,
} from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import { decodeGreyAlphaPng } from '@open-northland/formats/png';
import type { AtlasManifest } from '@open-northland/render';
import sharp from 'sharp';
import { BOBS_DIR, type BobAtlasCatalog } from '../../src/stages/content-tree.js';

/** Decodes a served sheet to its RGBA bytes, as packed. */
export async function decodeAtlasImage(bytes: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8Array(data) };
}

/** Writes the catalog's `bobs/atlases.json` and reads one stem back from it, as the app does. */
export async function readServedManifest(atlases: BobAtlasCatalog, stem: string): Promise<AtlasManifest> {
  await atlases.writeDocument();
  const raw = await readFile(join(atlases.outDir, BOB_ATLASES_PATH), 'utf8');
  const manifest = bobAtlasManifest(BobAtlasSet.parse(JSON.parse(raw)), stem);
  if (manifest === undefined) throw new Error(`${stem}: not in ${BOB_ATLASES_PATH}`);
  return manifest;
}

/** The sheet a stem's manifest names, decoded and coloured through the stem's palette as the app does. */
export async function readServedSheet(atlases: BobAtlasCatalog, stem: string): Promise<RgbaImage> {
  const { image, palette, imageEncoding } = await readServedManifest(atlases, stem);
  const bytes = await readFile(join(atlases.outDir, BOBS_DIR, image));
  if (palette === undefined) return decodeAtlasImage(bytes);
  if (imageEncoding !== 'index-coverage-png') throw new Error(`${stem}: paletted sheet without its encoding`);
  const { width, height, pixels } = await decodeGreyAlphaPng(bytes);
  const rgba = new Uint8Array(width * height * 4);
  colourIndexedSheet(pixels, GREY_ALPHA_INDEXED, decodeAtlasPalette(palette), rgba);
  return { width, height, rgba };
}
