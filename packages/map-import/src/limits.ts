import { DEFAULT_HYPERTEXT_CHARACTERS } from '@open-northland/formats/hypertext';

const MIB = 1024 * 1024;
const MEGAPIXEL = 1024 * 1024;

/** The largest checked campaign consumes 1,283,400 characters including picture discovery.
 * Four per-map budgets leave room for larger packs without allowing unlimited include expansion. */
export const DEFAULT_TOTAL_HYPERTEXT_CHARACTERS = 4 * DEFAULT_HYPERTEXT_CHARACTERS;

/** Upper bounds on one untrusted import, checked before and while it unpacks. */
export interface ImportLimits {
  /** Bytes of the archive file itself. */
  readonly archiveBytes: number;
  /** Bytes of every kept entry together, nested archives included. */
  readonly unpackedBytes: number;
  /** Bytes of one entry, declared or actual. */
  readonly entryBytes: number;
  /** Entries listed by the archive and every nested one, kept or not. */
  readonly entries: number;
  /** Path segments of one kept entry, its file name and any nested archive's prefix included. */
  readonly depth: number;
  /** Cells (`width * height`) of one map's grid, checked against its `lsiz` before a lane unpacks. */
  readonly cells: number;
  /** Cells retained across every decoded map in one tree. */
  readonly totalCells: number;
  /** Pixels (`width * height`) of one picture, checked against its header before it decodes. */
  readonly picturePixels: number;
  /** Processed briefing characters per map, including include expansion and picture discovery. */
  readonly hypertextCharacters: number;
  /** Processed briefing characters across the complete pack. */
  readonly totalHypertextCharacters: number;
}

/** Defaults sized from the culturesnation catalogue: its largest archive unpacks to 20 MB, its largest
 *  entry is 5.7 MB, one archive lists at most 2367 entries, and a map folder sits at most three deep. */
export const DEFAULT_ARCHIVE_BYTES = 64 * MIB;
export const DEFAULT_UNPACKED_BYTES = 128 * MIB;
export const DEFAULT_ENTRY_BYTES = 16 * MIB;
export const DEFAULT_ENTRIES = 5000;
export const DEFAULT_DEPTH = 8;
/** The largest known map is 500x500 cells. About four times its area leaves room for bigger custom
 *  maps while the per-cell arrays a decode builds, several at four half-cells per cell, stay in the
 *  low hundreds of megabytes. */
export const DEFAULT_CELLS = 1024 * 1024;
/** Four maximum-size maps, or sixteen 500x500 maps, per pack. This bounds retained terrain lanes
 *  across a campaign independently of the highly compressible input bytes; it is not a byte cap. */
export const DEFAULT_TOTAL_CELLS = 4 * DEFAULT_CELLS;
/** Map and briefing pictures are menu-sized; 16 Mpx is far above them and bounds one picture's
 *  RGBA expansion at 64 MiB. */
export const DEFAULT_PICTURE_PIXELS = 16 * MEGAPIXEL;

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: DEFAULT_ARCHIVE_BYTES,
  unpackedBytes: DEFAULT_UNPACKED_BYTES,
  entryBytes: DEFAULT_ENTRY_BYTES,
  entries: DEFAULT_ENTRIES,
  depth: DEFAULT_DEPTH,
  cells: DEFAULT_CELLS,
  totalCells: DEFAULT_TOTAL_CELLS,
  picturePixels: DEFAULT_PICTURE_PIXELS,
  hypertextCharacters: DEFAULT_HYPERTEXT_CHARACTERS,
  totalHypertextCharacters: DEFAULT_TOTAL_HYPERTEXT_CHARACTERS,
};

/** No bound at all, for a trusted source such as the mod tree the pipeline converts. */
export const NO_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: Number.POSITIVE_INFINITY,
  unpackedBytes: Number.POSITIVE_INFINITY,
  entryBytes: Number.POSITIVE_INFINITY,
  entries: Number.POSITIVE_INFINITY,
  depth: Number.POSITIVE_INFINITY,
  cells: Number.POSITIVE_INFINITY,
  totalCells: Number.POSITIVE_INFINITY,
  picturePixels: Number.POSITIVE_INFINITY,
  hypertextCharacters: Number.POSITIVE_INFINITY,
  totalHypertextCharacters: Number.POSITIVE_INFINITY,
};
