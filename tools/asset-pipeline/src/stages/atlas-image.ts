import { createHash } from 'node:crypto';
import type { RgbaImage } from '@open-northland/formats/image';
import sharp from 'sharp';

/** The served atlas sheet format: lossless WebP, about half the bytes of our zlib-default PNG. */
export const ATLAS_IMAGE_EXTENSION = '.webp';

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
export function atlasImageName(image: RgbaImage): string {
  const hash = createHash('sha256')
    .update(`${image.width}x${image.height}\n`)
    .update(image.rgba)
    .digest('hex');
  return `${hash.slice(0, NAME_HASH_HEX)}${ATLAS_IMAGE_EXTENSION}`;
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
