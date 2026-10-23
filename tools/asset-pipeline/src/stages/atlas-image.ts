import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, deflate } from 'node:zlib';
import { indexedToGreyAlpha } from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import { encodeGreyAlphaPng } from '@open-northland/formats/png';
import sharp from 'sharp';

/** The served format of a sheet whose every pixel is opaque or transparent: lossless WebP, about half
 *  the bytes of our zlib-default PNG. */
export const ATLAS_IMAGE_EXTENSION = '.webp';

/**
 * The served format of a sheet with graded alpha. Chromium premultiplies a decoded WebP with its own
 * rounding, unlike its PNG decoder and its `ImageData` path, so a WebP of such a sheet draws partly
 * transparent pixels 1 level off; a PNG decodes exactly as the paletted sheets' colouring does.
 */
export const GRADED_ATLAS_IMAGE_EXTENSION = '.png';

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
/** zlib's smallest setting for a graded-alpha sheet's PNG. */
const PNG_SMALLEST_LEVEL = 9;

const OPAQUE = 255;
const ALPHA_CHANNEL = 3;

/** True when some pixel is neither fully transparent nor opaque. */
function hasGradedAlpha({ rgba }: RgbaImage): boolean {
  for (let i = ALPHA_CHANNEL; i < rgba.length; i += 4) {
    const alpha = rgba[i] ?? 0;
    if (alpha !== 0 && alpha !== OPAQUE) return true;
  }
  return false;
}

/** The served file extension of an RGBA sheet: see {@link GRADED_ATLAS_IMAGE_EXTENSION}. */
export function atlasImageExtension(image: RgbaImage): string {
  return hasGradedAlpha(image) ? GRADED_ATLAS_IMAGE_EXTENSION : ATLAS_IMAGE_EXTENSION;
}

/**
 * The content-addressed file name of a sheet, so byte-identical sheets of different stems (a build-time
 * sheet every recolour shares, an empty bob set) are written and fetched once.
 */
export function atlasImageName(image: RgbaImage, extension = atlasImageExtension(image)): string {
  const hash = createHash('sha256')
    .update(`${image.width}x${image.height}\n`)
    .update(image.rgba)
    .digest('hex');
  return `${hash.slice(0, NAME_HASH_HEX)}${extension}`;
}

/**
 * Encodes a sheet in the format `extension` ({@link atlasImageExtension}) names: lossless WebP, where
 * `exact` keeps the RGB under fully transparent pixels, which libwebp otherwise rewrites, or PNG. Either
 * decodes to the bytes it was packed from.
 */
export async function encodeAtlasImage(
  image: RgbaImage,
  extension = atlasImageExtension(image),
): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const pixels = sharp(rgba, { raw: { width, height, channels: 4 }, limitInputPixels: false });
  return extension === GRADED_ATLAS_IMAGE_EXTENSION
    ? pixels.png({ compressionLevel: PNG_SMALLEST_LEVEL }).toBuffer()
    : pixels
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
