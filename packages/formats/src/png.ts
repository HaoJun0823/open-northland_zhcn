/**
 * PNG container encoder/decoder for 8-bit truecolour + alpha (colour type 6) and grey + alpha (colour
 * type 4) images. This is the pipeline's output container, not an original game format, so the layout
 * follows the PNG spec (W3C / ISO 15948):
 *   signature 89 50 4E 47 0D 0A 1A 0A, then length-prefixed CRC-32'd chunks IHDR, IDAT(s), IEND
 *   (all multi-byte fields big-endian).
 * It runs in a browser worker too, so inflating goes through the Web Streams API (`compress.ts`).
 */

import { viewOf } from './byte-cursor.js';
import { deflate, inflate } from './compress.js';
import type { RgbaImage } from './image.js';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_BYTES = 13;
const BIT_DEPTH = 8;
const COLOR_TYPE_GREY_ALPHA = 4;
const COLOR_TYPE_RGBA = 6;
type ColorType = typeof COLOR_TYPE_GREY_ALPHA | typeof COLOR_TYPE_RGBA;
/** Bytes per pixel at 8 bits per channel. */
const CHANNELS: Readonly<Record<ColorType, number>> = {
  [COLOR_TYPE_GREY_ALPHA]: 2,
  [COLOR_TYPE_RGBA]: 4,
};

/** The scanline filter types (PNG spec section 9.2); each row's first byte names one. */
const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

/** Two bytes per pixel: grey then alpha, row-major. */
export interface GreyAlphaImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface PngEncodeOptions {
  /** A zlib (RFC 1950) compressor in place of the default-level Web Streams one, such as a level-9 one. */
  readonly deflate?: (bytes: Uint8Array) => Promise<Uint8Array>;
}

// CRC-32 (ISO 3309, reflected, polynomial 0xEDB88320) over chunk type + data, per the PNG spec.
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Serializes one PNG chunk: `[u32 length][4-byte ASCII type][data][u32 CRC]` (CRC over type + data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/**
 * The simplest conformant stream: no interlace, filter-None scanlines, one zlib-deflated IDAT. On the
 * paletted atlas sheets at deflate level 9, per-row adaptive filtering (minimum sum of absolute
 * differences) came out 6% larger than None, so the encoder does not filter.
 */
async function encodeRows(
  width: number,
  height: number,
  colorType: ColorType,
  data: Uint8Array,
  options: PngEncodeOptions,
): Promise<Uint8Array> {
  const channels = CHANNELS[colorType];
  if (width <= 0 || height <= 0) {
    throw new Error(`png: cannot encode invalid dimensions ${width}x${height}`);
  }
  if (data.length !== width * height * channels) {
    throw new Error(
      `png: pixel length ${data.length} does not match ${width}x${height}x${channels} = ${width * height * channels}`,
    );
  }

  const stride = width * channels;
  // Each scanline is prefixed with its filter-type byte; 0 (None) is already the zero fill.
  const filtered = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = await (options.deflate ?? deflate)(filtered);

  const ihdr = new Uint8Array(IHDR_BYTES);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width, false);
  hv.setUint32(4, height, false);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = colorType;
  // bytes 10..12 (compression / filter / interlace methods) stay 0.

  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

/** Encodes straight 8-bit RGBA pixels as colour type 6 (truecolour plus alpha). */
export function encodePng(image: RgbaImage, options: PngEncodeOptions = {}): Promise<Uint8Array> {
  return encodeRows(image.width, image.height, COLOR_TYPE_RGBA, image.rgba, options);
}

/** Encodes grey + alpha pixels as colour type 4. */
export function encodeGreyAlphaPng(
  image: GreyAlphaImage,
  options: PngEncodeOptions = {},
): Promise<Uint8Array> {
  return encodeRows(image.width, image.height, COLOR_TYPE_GREY_ALPHA, image.pixels, options);
}

/** The pixels of a PNG this module can read: 8-bit, non-interlaced, of colour type `colorType`. */
async function decodeRows(
  bytes: Uint8Array,
  colorType: ColorType,
): Promise<{ width: number; height: number; data: Uint8Array }> {
  if (bytes.length < SIGNATURE.length || !signatureMatches(bytes)) {
    throw new Error('png: not a PNG (bad signature)');
  }

  const view = viewOf(bytes);
  let width = 0;
  let height = 0;
  let sawHeader = false;
  const idatParts: Uint8Array[] = [];

  let off = SIGNATURE.length;
  while (off + 8 <= bytes.length) {
    const length = view.getUint32(off, false);
    const type = String.fromCharCode(
      bytes[off + 4] ?? 0,
      bytes[off + 5] ?? 0,
      bytes[off + 6] ?? 0,
      bytes[off + 7] ?? 0,
    );
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`png: ${type} chunk overruns the buffer`);
    }
    const expectedCrc = view.getUint32(dataEnd, false);
    if (crc32(bytes.subarray(off + 4, dataEnd)) !== expectedCrc) {
      throw new Error(`png: CRC mismatch in ${type} chunk`);
    }

    if (type === 'IHDR') {
      if (length !== IHDR_BYTES) throw new Error(`png: IHDR must be ${IHDR_BYTES} bytes, got ${length}`);
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const headerColorType = bytes[dataStart + 9] ?? 0;
      const interlace = bytes[dataStart + 12] ?? 0;
      if (bitDepth !== BIT_DEPTH || headerColorType !== colorType || interlace !== 0) {
        throw new Error(
          `png: unsupported header (bitDepth=${bitDepth} colorType=${headerColorType} interlace=${interlace}); expected 8-bit colour type ${colorType}, non-interlaced`,
        );
      }
      if (width <= 0 || height <= 0) throw new Error(`png: invalid dimensions ${width}x${height}`);
      sawHeader = true;
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    off = dataEnd + 4;
  }

  if (!sawHeader) throw new Error('png: missing IHDR chunk');
  if (idatParts.length === 0) throw new Error('png: missing IDAT data');

  const filtered: Uint8Array = await inflate(concat(idatParts));
  const channels = CHANNELS[colorType];
  const stride = width * channels;
  if (filtered.length < height * (stride + 1)) {
    throw new Error(
      `png: pixel stream too short (${filtered.length} < ${height * (stride + 1)} for ${width}x${height})`,
    );
  }
  return { width, height, data: unfilter(filtered, width, height, channels) };
}

/** The Paeth predictor (PNG spec section 9.4): whichever of left, up, upper-left is nearest `a + b - c`. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses each scanline's filter (PNG spec section 9.2) into unfiltered rows, `bpp` bytes per pixel. */
function unfilter(filtered: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    const filter = filtered[from - 1] ?? 0;
    if (filter === FILTER_NONE) {
      out.set(filtered.subarray(from, from + stride), row);
      continue;
    }
    for (let i = 0; i < stride; i++) {
      const x = filtered[from + i] ?? 0;
      const a = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[up + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (out[up + i - bpp] ?? 0) : 0;
      let predicted: number;
      if (filter === FILTER_SUB) predicted = a;
      else if (filter === FILTER_UP) predicted = b;
      else if (filter === FILTER_AVERAGE) predicted = (a + b) >>> 1;
      else if (filter === FILTER_PAETH) predicted = paeth(a, b, c);
      else throw new Error(`png: unknown row filter ${filter} on row ${y}`);
      out[row + i] = (x + predicted) & 0xff;
    }
  }
  return out;
}

/**
 * Parses an 8-bit, non-interlaced colour type 6 PNG into straight RGBA. Throws a `png:`-prefixed error
 * on a bad signature, a CRC mismatch, another header, an unknown row filter, or a truncated pixel stream.
 */
export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  const { width, height, data } = await decodeRows(bytes, COLOR_TYPE_RGBA);
  return { width, height, rgba: data };
}

/** {@link decodePng} for an 8-bit colour type 4 PNG: grey + alpha pixels. */
export async function decodeGreyAlphaPng(bytes: Uint8Array): Promise<GreyAlphaImage> {
  const { width, height, data } = await decodeRows(bytes, COLOR_TYPE_GREY_ALPHA);
  return { width, height, pixels: data };
}

function signatureMatches(bytes: Uint8Array): boolean {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
