import { MAP_DAT_FILE } from './layout.js';
import type { MapTree } from './tree.js';

/** Stands in for the folder name of a map at the tree root when the caller names none. */
export const DEFAULT_ROOT_NAME = 'map';

/** One map folder of a tree, read by case-folded segments relative to it. */
export interface MapFolder {
  /** The spelled `map.dat` path, naming the map in warnings. */
  readonly rel: string;
  /** The spelled folder path; a map at the tree root takes the import's root name. */
  readonly path: string;
  /** The file at `segments` under the folder, matched case-insensitively. */
  read(segments: readonly string[]): Uint8Array | undefined;
  /** Reports a recoverable problem with one of the folder's files. */
  warn(message: string): void;
}

/** The folder `key` (lower-cased, `''` for the root) of `tree`. */
export function mapFolderOf(
  tree: MapTree,
  key: string,
  rootName: string,
  onWarning: (message: string) => void,
): MapFolder {
  const prefix = key === '' ? '' : `${key}/`;
  const datKey = `${prefix}${MAP_DAT_FILE}`;
  const spelledDat = tree.names.get(datKey) ?? datKey;
  const path = key === '' ? rootName : spelledDat.slice(0, spelledDat.lastIndexOf('/'));
  const rel = key === '' ? `${rootName}/${spelledDat}` : spelledDat;
  return {
    rel,
    path,
    read: (segments) => tree.files.get(`${prefix}${segments.join('/').toLowerCase()}`),
    warn: (message) => onWarning(`map ${rel}: ${message}`),
  };
}
