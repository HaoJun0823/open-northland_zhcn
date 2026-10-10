import type { MapFolder } from '../../src/folder.js';
import { mapFolderOf } from '../../src/folder.js';
import type { MapTree } from '../../src/tree.js';

/** An in-memory map folder `x` (its `map.dat` at `x/map.dat`) that a test lays files into. */
export interface TestFolder {
  readonly folder: MapFolder;
  readonly tree: MapTree;
  /** Writes `data` at `rel` under the folder; strings are stored as latin1 bytes. */
  write(rel: string, data: string | Uint8Array): void;
  /** Every warning the folder reported, already prefixed with the map. */
  readonly warnings: string[];
}

export const TEST_FOLDER = 'x';

/** Latin1 bytes of `text`, one byte per code unit, so a test can write any single-byte encoding. */
export function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/** A tree from `files`, keyed by their spelled paths. */
export function treeOf(files: Readonly<Record<string, string | Uint8Array>>): MapTree & {
  files: Map<string, Uint8Array>;
  names: Map<string, string>;
} {
  const tree = { files: new Map<string, Uint8Array>(), names: new Map<string, string>() };
  for (const [path, data] of Object.entries(files)) {
    tree.files.set(path.toLowerCase(), typeof data === 'string' ? latin1(data) : data);
    tree.names.set(path.toLowerCase(), path);
  }
  return tree;
}

export function testFolder(): TestFolder {
  const tree = treeOf({ [`${TEST_FOLDER}/map.dat`]: new Uint8Array() });
  const warnings: string[] = [];
  return {
    folder: mapFolderOf(tree, TEST_FOLDER, 'root', (message) => warnings.push(message)),
    tree,
    write: (rel, data) => {
      const path = `${TEST_FOLDER}/${rel}`;
      tree.files.set(path.toLowerCase(), typeof data === 'string' ? latin1(data) : data);
      tree.names.set(path.toLowerCase(), path);
    },
    warnings,
  };
}
