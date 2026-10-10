import { MAP_DAT_FILE, STRING_TABLE_DIR } from './layout.js';
import type { MapTree } from './tree.js';

/** The folder part of a `/`-separated path, `''` at the root. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** The last segment of a `/`-separated path. */
function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Slugs a folder name into a map id. The `.cif` logic header carries no human-readable id, so the
 * one-per-folder name is the stable cross-reference key, slugged like the type ids the `.ini`
 * extractors mint. Letters with a combining mark fold to the base letter first, so the id does not
 * depend on the Unicode normalization the host file system stored the folder in.
 */
export function mapIdFromFolderName(folder: string): string {
  return folder
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Slugs a map file's containing-folder name into its id; either separator. */
export function mapIdFromPath(mapFileRelPath: string): string {
  return mapIdFromFolderName(lastSegment(parentOf(mapFileRelPath.replace(/\\/g, '/'))));
}

/**
 * Drops stray string-table copies from a map-file candidate list: a `text/` subfolder can carry a
 * stale revision of the map file, which would otherwise convert as a ghost map with id `text`. A
 * candidate is dropped only when the parent folder holds a candidate of its own, so a top-level map
 * folder named `text` still converts.
 */
export function excludeStringTableCopies<T extends { readonly rel: string }>(found: readonly T[]): T[] {
  const candidateDirs = new Set(found.map(({ rel }) => parentOf(rel).toLowerCase()));
  return found.filter(({ rel }) => {
    const dir = parentOf(rel);
    return !(
      lastSegment(dir).toLowerCase() === STRING_TABLE_DIR && candidateDirs.has(parentOf(dir).toLowerCase())
    );
  });
}

/**
 * The folders of a tree that hold a `map.dat`, as lower-cased keys (`''` for the root), ordered by
 * their spelled path in code-unit order like a sorted directory walk, string-table copies excluded.
 */
export function findMapFolders(tree: MapTree): string[] {
  const found: { rel: string; key: string }[] = [];
  for (const key of tree.files.keys()) {
    if (lastSegment(key) !== MAP_DAT_FILE) continue;
    found.push({ rel: tree.names.get(key) ?? key, key });
  }
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return excludeStringTableCopies(found).map(({ key }) => parentOf(key));
}
