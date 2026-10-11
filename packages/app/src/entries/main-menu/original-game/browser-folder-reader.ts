import type { FolderEntry, FolderPath, FolderReader } from '@open-northland/ownership';

/**
 * Two ways a browser hands over a folder, behind one `FolderReader`. Chromium's directory picker gives
 * handles, which are listed one directory at a time as the rule walks; `<input webkitdirectory>` gives
 * every file at once with its path. Either way only the heads the rule asks for are read.
 */

/** The File System Access handles the reader uses; Chromium only, so not in the DOM typings. */
export interface PickedFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

export interface PickedDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<PickedFileHandle | PickedDirectoryHandle>;
}

export type DirectoryPicker = (options: { readonly mode: 'read' }) => Promise<PickedDirectoryHandle>;

/** `showDirectoryPicker` where the browser offers it. */
export function directoryPicker(): DirectoryPicker | undefined {
  const picker: unknown = Reflect.get(window, 'showDirectoryPicker');
  if (typeof picker !== 'function') return undefined;
  return (options) => Reflect.apply(picker, window, [options]) as Promise<PickedDirectoryHandle>;
}

async function head(file: File, bytes: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

interface Listing {
  readonly entries: readonly FolderEntry[];
  readonly files: ReadonlyMap<string, File>;
  readonly directories: ReadonlyMap<string, PickedDirectoryHandle>;
}

/** Reads below a picked directory; any failure reads as an absent entry. */
export function directoryHandleReader(root: PickedDirectoryHandle): FolderReader {
  // The rule lists the same directories again for each layout it tries.
  const listings = new Map<string, Promise<Listing | undefined>>();

  async function readListing(directory: PickedDirectoryHandle): Promise<Listing | undefined> {
    const entries: FolderEntry[] = [];
    const files = new Map<string, File>();
    const directories = new Map<string, PickedDirectoryHandle>();
    try {
      for await (const handle of directory.values()) {
        if (handle.kind === 'directory') {
          directories.set(handle.name, handle);
          entries.push({ name: handle.name, kind: 'directory' });
        } else {
          // A `File` is a snapshot of the entry's metadata; nothing of its content is read here.
          const file = await handle.getFile();
          files.set(handle.name, file);
          entries.push({ name: handle.name, kind: 'file', size: file.size });
        }
      }
    } catch {
      return undefined;
    }
    return { entries, files, directories };
  }

  function listing(path: FolderPath): Promise<Listing | undefined> {
    const key = path.join('/');
    let pending = listings.get(key);
    if (pending === undefined) {
      pending = directoryAt(path).then((directory) =>
        directory === undefined ? undefined : readListing(directory),
      );
      listings.set(key, pending);
    }
    return pending;
  }

  async function directoryAt(path: FolderPath): Promise<PickedDirectoryHandle | undefined> {
    const name = path.at(-1);
    if (name === undefined) return root;
    return (await listing(path.slice(0, -1)))?.directories.get(name);
  }

  return {
    async list(dir) {
      return (await listing(dir))?.entries;
    },
    async readHead(path, bytes) {
      const name = path.at(-1);
      if (name === undefined) return undefined;
      const file = (await listing(path.slice(0, -1)))?.files.get(name);
      if (file === undefined) return undefined;
      try {
        return await head(file, bytes);
      } catch {
        return undefined;
      }
    },
  };
}

interface FileTreeNode {
  readonly directories: Map<string, FileTreeNode>;
  readonly files: Map<string, File>;
}

function treeNode(): FileTreeNode {
  return { directories: new Map(), files: new Map() };
}

function relativeSegments(file: File): string[] {
  const path = file.webkitRelativePath === '' ? file.name : file.webkitRelativePath;
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Every path starts with the picked folder's own name, which the rule must not see as a level. */
function withoutCommonTop(paths: readonly string[][]): readonly string[][] {
  const top = paths[0]?.[0];
  const shared = paths.every((segments) => segments.length > 1 && segments[0] === top);
  return shared ? paths.map((segments) => segments.slice(1)) : paths;
}

/** The picked folder's name: the top every returned path shares; null when the paths carry none. */
export function pickedFolderName(files: Iterable<File>): string | null {
  const paths = [...files].map(relativeSegments);
  const top = paths[0]?.[0];
  if (top === undefined) return null;
  return paths.every((segments) => segments.length > 1 && segments[0] === top) ? top : null;
}

/** Reads the files an `<input webkitdirectory>` returned, by their `webkitRelativePath`. */
export function fileListReader(files: Iterable<File>): FolderReader {
  const picked = [...files];
  const root = treeNode();
  const paths = withoutCommonTop(picked.map(relativeSegments));
  picked.forEach((file, index) => {
    const segments = paths[index] ?? [];
    const name = segments.at(-1);
    if (name === undefined) return;
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      let child = node.directories.get(segment);
      if (child === undefined) {
        child = treeNode();
        node.directories.set(segment, child);
      }
      node = child;
    }
    node.files.set(name, file);
  });

  const nodeAt = (path: FolderPath): FileTreeNode | undefined => {
    let node: FileTreeNode | undefined = root;
    for (const segment of path) node = node?.directories.get(segment);
    return node;
  };

  return {
    async list(dir) {
      const node = nodeAt(dir);
      if (node === undefined) return undefined;
      return [
        ...[...node.directories.keys()].map((name): FolderEntry => ({ name, kind: 'directory' })),
        ...[...node.files].map(([name, file]): FolderEntry => ({ name, kind: 'file', size: file.size })),
      ];
    },
    async readHead(path, bytes) {
      const name = path.at(-1);
      const file = name === undefined ? undefined : nodeAt(path.slice(0, -1))?.files.get(name);
      if (file === undefined) return undefined;
      try {
        return await head(file, bytes);
      } catch {
        return undefined;
      }
    },
  };
}
