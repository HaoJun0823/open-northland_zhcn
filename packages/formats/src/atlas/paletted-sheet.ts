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

/**
 * Colours a paletted sheet's pixels (laid out as `layout` says) through `palette` into straight RGBA
 * `out`: a covered pixel takes the indexed colour with its coverage as alpha, an uncovered one is all
 * zero. These are the bytes the pipeline's RGB bake of the same bob set writes.
 */
export function colourIndexedSheet(
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
