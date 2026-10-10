const MIB = 1024 * 1024;

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
}

/** Defaults sized from the culturesnation catalogue: its largest archive unpacks to 20 MB, its largest
 *  entry is 5.7 MB, one archive lists at most 2367 entries, and a map folder sits at most three deep. */
export const DEFAULT_ARCHIVE_BYTES = 64 * MIB;
export const DEFAULT_UNPACKED_BYTES = 128 * MIB;
export const DEFAULT_ENTRY_BYTES = 16 * MIB;
export const DEFAULT_ENTRIES = 5000;
export const DEFAULT_DEPTH = 8;

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: DEFAULT_ARCHIVE_BYTES,
  unpackedBytes: DEFAULT_UNPACKED_BYTES,
  entryBytes: DEFAULT_ENTRY_BYTES,
  entries: DEFAULT_ENTRIES,
  depth: DEFAULT_DEPTH,
};

/** No bound at all, for a trusted source such as the mod tree the pipeline converts. */
export const NO_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: Number.POSITIVE_INFINITY,
  unpackedBytes: Number.POSITIVE_INFINITY,
  entryBytes: Number.POSITIVE_INFINITY,
  entries: Number.POSITIVE_INFINITY,
  depth: Number.POSITIVE_INFINITY,
};
