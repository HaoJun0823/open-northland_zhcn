import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FolderEntry, FolderPath, FolderReader } from '@open-northland/ownership';

async function entryAt(path: string, name: string): Promise<FolderEntry | undefined> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return { name, kind: 'directory' };
    if (info.isFile()) return { name, kind: 'file', size: info.size };
  } catch {
    // A dangling link or an entry removed mid-listing is not part of the folder.
  }
  return undefined;
}

/** Reads below an absolute `root`; any failure reads as an absent entry. */
export function nodeFolderReader(root: string): FolderReader {
  const resolve = (path: FolderPath): string => join(root, ...path);
  return {
    async list(dir) {
      const path = resolve(dir);
      let names: string[];
      try {
        names = await readdir(path);
      } catch {
        return undefined;
      }
      const entries = await Promise.all(names.map((name) => entryAt(join(path, name), name)));
      return entries.filter((entry) => entry !== undefined);
    },
    async readHead(file, bytes) {
      try {
        const handle = await open(resolve(file), 'r');
        try {
          const buffer = new Uint8Array(bytes);
          const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
          return buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      } catch {
        return undefined;
      }
    },
  };
}
