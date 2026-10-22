import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AtlasFrame } from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import type { AtlasManifest } from '@open-northland/render';
import sharp from 'sharp';
import { ATLAS_MANIFEST_SUFFIX, BOBS_DIR } from '../../src/stages/content-tree.js';

/** A written `<stem>.atlas.json` with the packer's full frame records. */
export type ServedManifest = AtlasManifest & { readonly frames: readonly AtlasFrame[] };

/** Decodes a served sheet to straight RGBA, the bytes the app's straight-alpha upload sees. */
export async function decodeAtlasImage(bytes: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8Array(data) };
}

export async function readServedManifest(out: string, stem: string): Promise<ServedManifest> {
  return JSON.parse(await readFile(join(out, BOBS_DIR, `${stem}${ATLAS_MANIFEST_SUFFIX}`), 'utf8'));
}

/** The sheet a stem's manifest names, decoded. */
export async function readServedSheet(out: string, stem: string): Promise<RgbaImage> {
  const { image } = await readServedManifest(out, stem);
  return decodeAtlasImage(await readFile(join(out, BOBS_DIR, image)));
}
