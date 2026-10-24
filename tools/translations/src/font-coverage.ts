import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';

/** The code points a font's cmap maps to a glyph, read from a WOFF2 file with Node alone. */

const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'
const COLLECTION_FLAVOR = 0x74746366; // 'ttcf'
const WOFF2_HEADER_BYTES = 48;
const HEADER_NUM_TABLES = 12;
const HEADER_COMPRESSED_SIZE = 20;
/** A table directory flag whose low six bits are this carries its tag as four bytes after it. */
const ARBITRARY_TAG = 0x3f;
const TAG_INDEX_MASK = 0x3f;
const TRANSFORM_SHIFT = 6;
const TRANSFORM_MASK = 0x3;
/** glyf and loca are transformed by default: transform version 0 is their transform, 3 the null one. */
const GLYF_LOCA_NULL_TRANSFORM = 3;
const UINT_BASE128_MAX_BYTES = 5;

/** The WOFF2 known-table tags, indexed by the low six bits of a directory entry's flags. */
// biome-ignore format: the spec's table reads in rows
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
] as const;

const CMAP_RECORDS = 4;
const CMAP_RECORD_BYTES = 8;
const CMAP_RECORD_OFFSET = 4;
const FORMAT_SEGMENT_MAPPING = 4;
const FORMAT_SEGMENTED_COVERAGE = 12;
const FORMAT4_SEG_COUNT_X2 = 6;
const FORMAT4_END_CODES = 14;
/** The terminating segment of a format 4 subtable maps U+FFFF to no glyph. */
const FORMAT4_LAST_CODE = 0xffff;
const GLYPH_ID_MASK = 0xffff;
const FORMAT12_NUM_GROUPS = 12;
const FORMAT12_GROUPS = 16;
const FORMAT12_GROUP_BYTES = 12;
const MISSING_GLYPH = 0;

/** Reads a UIntBase128 at `offset`, answering the value and the offset after it. */
function readUIntBase128(view: DataView, offset: number): { readonly value: number; readonly next: number } {
  let value = 0;
  for (let i = 0; i < UINT_BASE128_MAX_BYTES; i++) {
    const byte = view.getUint8(offset + i);
    if (i === 0 && byte === 0x80) throw new Error('woff2: UIntBase128 with a leading zero byte');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error('woff2: UIntBase128 longer than five bytes');
}

const tagOf = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

/** The untransformed cmap table of a WOFF2 font. WOFF2 transforms only glyf, loca and hmtx; the
 *  decompressed stream holds every table back to back in directory order. */
function woff2Cmap(bytes: Uint8Array): DataView {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== WOFF2_SIGNATURE) throw new Error('woff2: not a WOFF2 file');
  if (view.getUint32(4) === COLLECTION_FLAVOR) throw new Error('woff2: font collections are not read');
  const numTables = view.getUint16(HEADER_NUM_TABLES);
  const compressedSize = view.getUint32(HEADER_COMPRESSED_SIZE);
  let offset = WOFF2_HEADER_BYTES;
  let streamOffset = 0;
  let cmap: { readonly start: number; readonly length: number } | undefined;
  for (let i = 0; i < numTables; i++) {
    const flags = view.getUint8(offset);
    offset += 1;
    let tag: string | undefined;
    if ((flags & TAG_INDEX_MASK) === ARBITRARY_TAG) {
      tag = tagOf(view, offset);
      offset += 4;
    } else {
      tag = KNOWN_TAGS[flags & TAG_INDEX_MASK];
    }
    const original = readUIntBase128(view, offset);
    offset = original.next;
    const transform = (flags >> TRANSFORM_SHIFT) & TRANSFORM_MASK;
    const transformed =
      tag === 'glyf' || tag === 'loca' ? transform !== GLYF_LOCA_NULL_TRANSFORM : transform !== 0;
    let length = original.value;
    if (transformed) {
      const stored = readUIntBase128(view, offset);
      offset = stored.next;
      length = stored.value;
    }
    if (tag === 'cmap') cmap = { start: streamOffset, length };
    streamOffset += length;
  }
  if (cmap === undefined) throw new Error('woff2: no cmap table');
  const stream = brotliDecompressSync(bytes.subarray(offset, offset + compressedSize));
  if (stream.byteLength !== streamOffset)
    throw new Error(`woff2: table stream is ${stream.byteLength} bytes, the directory says ${streamOffset}`);
  return new DataView(stream.buffer, stream.byteOffset + cmap.start, cmap.length);
}

/** Adds the code points of a format 4 subtable at `at` that map to a glyph. */
function addFormat4(cmap: DataView, at: number, into: Set<number>): void {
  const segCount = cmap.getUint16(at + FORMAT4_SEG_COUNT_X2) / 2;
  const ends = at + FORMAT4_END_CODES;
  const starts = ends + segCount * 2 + 2; // a reserved pad word follows the end codes
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = cmap.getUint16(ends + s * 2);
    const start = cmap.getUint16(starts + s * 2);
    const delta = cmap.getUint16(deltas + s * 2);
    const rangeOffsetAt = rangeOffsets + s * 2;
    const rangeOffset = cmap.getUint16(rangeOffsetAt);
    for (let code = start; code <= end && code !== FORMAT4_LAST_CODE; code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & GLYPH_ID_MASK;
      } else {
        const raw = cmap.getUint16(rangeOffsetAt + rangeOffset + (code - start) * 2);
        glyph = raw === MISSING_GLYPH ? MISSING_GLYPH : (raw + delta) & GLYPH_ID_MASK;
      }
      if (glyph !== MISSING_GLYPH) into.add(code);
    }
  }
}

/** Adds the code points of a format 12 subtable at `at` that map to a glyph. */
function addFormat12(cmap: DataView, at: number, into: Set<number>): void {
  const groups = cmap.getUint32(at + FORMAT12_NUM_GROUPS);
  for (let g = 0; g < groups; g++) {
    const group = at + FORMAT12_GROUPS + g * FORMAT12_GROUP_BYTES;
    const start = cmap.getUint32(group);
    const end = cmap.getUint32(group + 4);
    const startGlyph = cmap.getUint32(group + 8);
    for (let code = start; code <= end; code++) {
      if (startGlyph + (code - start) !== MISSING_GLYPH) into.add(code);
    }
  }
}

/** Every code point the cmap's format 4 and 12 subtables map to a glyph. */
function cmapCodePoints(cmap: DataView): ReadonlySet<number> {
  const covered = new Set<number>();
  const records = cmap.getUint16(2);
  const seen = new Set<number>();
  for (let r = 0; r < records; r++) {
    const at = cmap.getUint32(CMAP_RECORDS + r * CMAP_RECORD_BYTES + CMAP_RECORD_OFFSET);
    if (seen.has(at)) continue;
    seen.add(at);
    const format = cmap.getUint16(at);
    if (format === FORMAT_SEGMENT_MAPPING) addFormat4(cmap, at, covered);
    else if (format === FORMAT_SEGMENTED_COVERAGE) addFormat12(cmap, at, covered);
  }
  return covered;
}

/** The code points the WOFF2 font at `path` draws. */
export async function woff2CodePoints(path: string): Promise<ReadonlySet<number>> {
  return cmapCodePoints(woff2Cmap(await readFile(path)));
}
