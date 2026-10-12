import { DEFAULT_IMPORT_LIMITS, isMapTreePath, MapImportError } from '@open-northland/map-import/input';

export interface LocalMapFile {
  readonly path: string;
  readonly file: Blob;
}

/** Blobs survive a structured clone without reading the whole input on the UI thread. */
export type LocalMapInput =
  | { readonly kind: 'archive'; readonly name: string; readonly file: Blob }
  | { readonly kind: 'folder'; readonly name: string; readonly files: readonly LocalMapFile[] };

function relativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..' || part.includes(':'))
  )
    throw new MapImportError('unsupported-archive', 'Invalid relative map path');
  if (normalized.split('/').length > DEFAULT_IMPORT_LIMITS.depth)
    throw new MapImportError('too-large', 'Map folder is too deep');
  return normalized;
}

/** Validates counts, paths and declared sizes before any file is read. Keeps map files only. */
export function checkedLocalInput(input: LocalMapInput): LocalMapInput {
  const name = relativePath(input.name);
  if (name.includes('/')) throw new MapImportError('unsupported-archive', 'Expected a file or folder name');
  if (input.kind === 'archive') {
    if (input.file.size > DEFAULT_IMPORT_LIMITS.archiveBytes)
      throw new MapImportError('too-large', 'Archive exceeds the import limit');
    return input;
  }
  if (input.files.length > DEFAULT_IMPORT_LIMITS.entries)
    throw new MapImportError('too-large', 'Too many files in the map folder');
  const files: LocalMapFile[] = [];
  const paths = new Set<string>();
  let total = 0;
  for (const item of input.files) {
    const path = relativePath(item.path);
    if (!isMapTreePath(path)) continue;
    const key = path.toLowerCase();
    if (paths.has(key)) throw new MapImportError('unsupported-archive', 'Duplicate map file path');
    paths.add(key);
    total += item.file.size;
    if (item.file.size > DEFAULT_IMPORT_LIMITS.entryBytes || total > DEFAULT_IMPORT_LIMITS.unpackedBytes)
      throw new MapImportError('too-large', 'Folder exceeds the import limit');
    files.push({ path, file: item.file });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { kind: 'folder', name, files };
}

export function localInputBytes(input: LocalMapInput): number {
  return input.kind === 'archive'
    ? input.file.size
    : input.files.reduce((sum, item) => sum + item.file.size, 0);
}

/** A retained source is independent of the generated map schemas and their IR version. */
export function storedLocalInput(raw: unknown): LocalMapInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.name !== 'string') return null;
  let input: LocalMapInput;
  if (value.kind === 'archive' && value.file instanceof Blob) {
    input = { kind: 'archive', name: value.name, file: value.file };
  } else if (value.kind === 'folder' && Array.isArray(value.files)) {
    const files: LocalMapFile[] = [];
    for (const rawFile of value.files) {
      if (typeof rawFile !== 'object' || rawFile === null) return null;
      const file = rawFile as Record<string, unknown>;
      if (typeof file.path !== 'string' || !(file.file instanceof Blob)) return null;
      files.push({ path: file.path, file: file.file });
    }
    input = { kind: 'folder', name: value.name, files };
  } else return null;
  try {
    return checkedLocalInput(input);
  } catch {
    return null;
  }
}
