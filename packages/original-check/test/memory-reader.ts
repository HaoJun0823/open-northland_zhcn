import type { FolderEntry, FolderPath, FolderReader } from '../src/index.js';

/** A directory is a nested record; a file is its content bytes. */
export type MemoryTree = { readonly [name: string]: MemoryTree | Uint8Array };

function walk(tree: MemoryTree, path: FolderPath): MemoryTree | Uint8Array | undefined {
  let node: MemoryTree | Uint8Array | undefined = tree;
  for (const segment of path) {
    if (node === undefined || node instanceof Uint8Array) return undefined;
    node = node[segment];
  }
  return node;
}

export function memoryReader(tree: MemoryTree): FolderReader {
  return {
    async list(dir: FolderPath): Promise<readonly FolderEntry[] | undefined> {
      const node = walk(tree, dir);
      if (node === undefined || node instanceof Uint8Array) return undefined;
      return Object.entries(node).map(([name, child]) =>
        child instanceof Uint8Array
          ? { name, kind: 'file', size: child.length }
          : { name, kind: 'directory' },
      );
    },
    async readHead(file: FolderPath, bytes: number): Promise<Uint8Array | undefined> {
      const node = walk(tree, file);
      return node instanceof Uint8Array ? node.subarray(0, bytes) : undefined;
    },
  };
}

/** A fake library head: the version, two counts, then the root `\\` and first `data\\` directory entries. */
export function libraryHead(
  options: { readonly totalSize?: number; readonly firstName?: string } = {},
): Uint8Array {
  const firstName = options.firstName ?? 'data\\';
  const size = Math.max(options.totalSize ?? 64, 25 + firstName.length);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 342, true);
  view.setUint32(8, 2691, true);
  view.setUint32(12, 1, true);
  bytes[16] = '\\'.charCodeAt(0);
  view.setUint32(17, 0, true);
  view.setUint32(21, firstName.length, true);
  bytes.set(
    [...firstName].map((char) => char.charCodeAt(0)),
    25,
  );
  return bytes;
}

export function cifHead(): Uint8Array {
  return new Uint8Array([0xfd, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
}

export function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}
