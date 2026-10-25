/** One palette entry: red, green, blue. */
const RGB = 3;
const RGBA = 4;
const ALPHA = 3;
/** A served palette's length: 256 RGB entries. */
export const ATLAS_PALETTE_BYTES = 256 * RGB;

/** The bytes of a manifest's base64 `palette`; throws unless it holds exactly 256 RGB entries. */
export function decodeAtlasPalette(base64: string): Uint8Array {
  const binary = atob(base64);
  if (binary.length !== ATLAS_PALETTE_BYTES) {
    throw new Error(`atlas palette: ${binary.length} bytes, expected ${ATLAS_PALETTE_BYTES}`);
  }
  const palette = new Uint8Array(ATLAS_PALETTE_BYTES);
  for (let i = 0; i < ATLAS_PALETTE_BYTES; i++) palette[i] = binary.charCodeAt(i);
  return palette;
}

/** Where a decoded paletted sheet's pixels hold their bytes: the palette index is each pixel's first
 *  byte, the coverage the byte at `coverage`. */
export interface IndexedPixelLayout {
  readonly bytesPerPixel: number;
  readonly coverage: number;
}

/** An `index-coverage-png` sheet decoded as it is stored: grey index, alpha coverage. */
export const GREY_ALPHA_INDEXED: IndexedPixelLayout = { bytesPerPixel: 2, coverage: 1 };

/** The same sheet drawn into a 2d canvas and read back: grey (so the index) in red, coverage in alpha. */
export const CANVAS_READ_INDEXED: IndexedPixelLayout = { bytesPerPixel: RGBA, coverage: ALPHA };

/** Whether typed-array views store their first byte lowest, so a `Uint16Array` over a grey + alpha
 *  sheet reads `index | coverage << 8` and one `Uint32Array` store writes R, G, B, A. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const BITS_PER_BYTE = 8;
const BYTE_VALUES = 256;
/** One coloured pixel per (index, coverage) pair of a grey + alpha sheet, rebuilt per palette. */
const pairColours = new Uint32Array(BYTE_VALUES * BYTE_VALUES);

/**
 * Colours a paletted sheet's pixels (laid out as `layout` says) through `palette` into straight RGBA
 * `out`: a covered pixel takes the indexed colour with its coverage as alpha, an uncovered one is all
 * zero. These are the bytes the pipeline's RGB bake of the same bob set writes. A grey + alpha sheet on
 * a little-endian host colours through a table of every (index, coverage) pair: one 16-bit read and
 * one 32-bit write per pixel.
 */
export function colourIndexedSheet(
  indexed: Uint8Array | Uint8ClampedArray,
  layout: IndexedPixelLayout,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray,
): void {
  const pairwise =
    LITTLE_ENDIAN &&
    layout.bytesPerPixel === GREY_ALPHA_INDEXED.bytesPerPixel &&
    layout.coverage === GREY_ALPHA_INDEXED.coverage &&
    indexed.byteOffset % GREY_ALPHA_INDEXED.bytesPerPixel === 0 &&
    indexed.length % GREY_ALPHA_INDEXED.bytesPerPixel === 0 &&
    out.byteOffset % RGBA === 0 &&
    out.length % RGBA === 0;
  if (!pairwise) {
    colourBytewise(indexed, layout, palette, out);
    return;
  }
  for (let entry = 0, p = 0; entry < BYTE_VALUES; entry++, p += RGB) {
    const rgb =
      (palette[p] ?? 0) |
      ((palette[p + 1] ?? 0) << BITS_PER_BYTE) |
      ((palette[p + 2] ?? 0) << (2 * BITS_PER_BYTE));
    pairColours[entry] = 0;
    for (let coverage = 1; coverage < BYTE_VALUES; coverage++) {
      pairColours[(coverage << BITS_PER_BYTE) | entry] = rgb | (coverage << (ALPHA * BITS_PER_BYTE));
    }
  }
  const pairs = new Uint16Array(
    indexed.buffer,
    indexed.byteOffset,
    indexed.length / GREY_ALPHA_INDEXED.bytesPerPixel,
  );
  const out32 = new Uint32Array(out.buffer, out.byteOffset, out.length / RGBA);
  const count = Math.min(pairs.length, out32.length);
  for (let i = 0; i < count; i++) out32[i] = pairColours[pairs[i] ?? 0] ?? 0;
}

/** {@link colourIndexedSheet} one byte at a time: the canvas-read layout, a big-endian host or an unaligned buffer. */
function colourBytewise(
  indexed: Uint8Array | Uint8ClampedArray,
  layout: IndexedPixelLayout,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray,
): void {
  const { bytesPerPixel, coverage: coverageByte } = layout;
  for (let i = 0, o = 0; i < indexed.length; i += bytesPerPixel, o += RGBA) {
    const coverage = indexed[i + coverageByte] ?? 0;
    if (coverage === 0) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + ALPHA] = 0;
      continue;
    }
    const p = (indexed[i] ?? 0) * RGB;
    out[o] = palette[p] ?? 0;
    out[o + 1] = palette[p + 1] ?? 0;
    out[o + 2] = palette[p + 2] ?? 0;
    out[o + ALPHA] = coverage;
  }
}
