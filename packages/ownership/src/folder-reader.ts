export type FolderEntryKind = 'file' | 'directory';

export interface FolderEntry {
  readonly name: string;
  readonly kind: FolderEntryKind;
  /** Bytes, for files; the browser and Node both know it from the listing. */
  readonly size?: number;
}

/** A path as segments below the reader's root, in the casing the listing returned. */
export type FolderPath = readonly string[];

export interface FolderReader {
  /** Entries of a directory; `undefined` when it is absent or unreadable. */
  list(dir: FolderPath): Promise<readonly FolderEntry[] | undefined>;
  /** The first `bytes` of a file (fewer at its end); `undefined` when absent or unreadable. */
  readHead(file: FolderPath, bytes: number): Promise<Uint8Array | undefined>;
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Resolves `wanted` (segments in any casing) to the entry the reader lists under that name,
 * walking one level at a time so each segment takes the casing the folder has.
 */
export async function findEntry(
  reader: FolderReader,
  wanted: FolderPath,
): Promise<{ readonly path: FolderPath; readonly entry: FolderEntry } | undefined> {
  const path: string[] = [];
  let entry: FolderEntry | undefined;
  for (const segment of wanted) {
    const entries = await reader.list(path);
    entry = entries?.find((candidate) => sameName(candidate.name, segment));
    if (entry === undefined) return undefined;
    path.push(entry.name);
  }
  return entry === undefined ? undefined : { path, entry };
}

export async function findFile(
  reader: FolderReader,
  wanted: FolderPath,
): Promise<{ readonly path: FolderPath; readonly size: number | undefined } | undefined> {
  const found = await findEntry(reader, wanted);
  if (found?.entry.kind !== 'file') return undefined;
  return { path: found.path, size: found.entry.size };
}
