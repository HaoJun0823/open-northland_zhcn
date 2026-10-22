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

/**
 * Colours an indexed sheet (palette index in red, coverage in alpha, straight) through `palette` into
 * `out`: a covered pixel takes the indexed colour and keeps its coverage, an uncovered one stays all
 * zero. These are the bytes the pipeline's RGB bake of the same bob set writes.
 */
export function colourIndexedSheet(
  indexed: Uint8Array | Uint8ClampedArray,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray,
): void {
  for (let o = 0; o < indexed.length; o += RGBA) {
    const coverage = indexed[o + ALPHA] ?? 0;
    if (coverage === 0) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + ALPHA] = 0;
      continue;
    }
    const p = (indexed[o] ?? 0) * RGB;
    out[o] = palette[p] ?? 0;
    out[o + 1] = palette[p + 1] ?? 0;
    out[o + 2] = palette[p + 2] ?? 0;
    out[o + ALPHA] = coverage;
  }
}
