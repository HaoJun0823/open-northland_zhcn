import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, deflate } from 'node:zlib';
import { indexedToGreyAlpha } from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import { encodeGreyAlphaPng } from '@open-northland/formats/png';
import sharp from 'sharp';

/** The served atlas sheet format: lossless WebP, about half the bytes of our zlib-default PNG. */
export const ATLAS_IMAGE_EXTENSION = '.webp';

/** A paletted sheet's file: an `index-coverage-png` (`AtlasImageEncoding`). */
export const PALETTED_SHEET_EXTENSION = '.png';

/** Hex digits of the SHA-256 that name a sheet: 64 bits, the hypertext pictures' width. */
const NAME_HASH_HEX = 16;

/**
 * libwebp's lossless effort pair. Measured on 12 real sheets: effort 6 at quality 75 encodes within 2.5%
 * of the maximum (quality 100, which took 13 times as long) and about 1% under the default effort 4.
 */
const WEBP_EFFORT = 6;
const WEBP_LOSSLESS_QUALITY = 75;

/**
 * The content-addressed file name of a sheet, so byte-identical sheets of different stems (a build-time
 * sheet every recolour shares, an empty bob set) are written and fetched once.
 */
export function atlasImageName(image: RgbaImage, extension = ATLAS_IMAGE_EXTENSION): string {
  const hash = createHash('sha256')
    .update(`${image.width}x${image.height}\n`)
    .update(image.rgba)
    .digest('hex');
  return `${hash.slice(0, NAME_HASH_HEX)}${extension}`;
}

/**
 * Encodes a sheet as lossless WebP. `exact` keeps the RGB under fully transparent pixels, which libwebp
 * otherwise rewrites, so a sheet decodes to the bytes it was packed from.
 */
export async function encodeAtlasImage(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  return sharp(rgba, { raw: { width, height, channels: 4 }, limitInputPixels: false })
    .webp({ lossless: true, exact: true, effort: WEBP_EFFORT, quality: WEBP_LOSSLESS_QUALITY })
    .toBuffer();
}

const deflateAsync = promisify(deflate);

/**
 * zlib at its smallest setting. On the paletted sheets a magiczny_las boot fetches, level 9 writes 1%
 * under the default level; a lossless WebP of the same pixels is still 27% smaller, but the browser
 * cannot decode one exactly without a canvas read.
 */
async function deflateSmallest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await deflateAsync(bytes, { level: constants.Z_BEST_COMPRESSION, memLevel: constants.Z_MAX_MEMLEVEL }),
  );
}

/** Encodes an indexed-layout sheet (`packIndexedBobAtlas`) as an `index-coverage-png`. */
export function encodePalettedSheet(image: RgbaImage): Promise<Uint8Array> {
  return encodeGreyAlphaPng(indexedToGreyAlpha(image), { deflate: deflateSmallest });
}
