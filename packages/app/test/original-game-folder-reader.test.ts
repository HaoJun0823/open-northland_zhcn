import { findInstall } from '@open-northland/ownership';
import { describe, expect, it } from 'vitest';
import { libraryHead } from '../../ownership/test/memory-reader.js';
import {
  directoryHandleReader,
  fileListReader,
  type PickedDirectoryHandle,
  type PickedFileHandle,
  pickedFolderName,
} from '../src/entries/main-menu/original-game/browser-folder-reader.js';

/** Bytes the rule reads from a library head. */
const LIBRARY_HEAD_BYTES = 32;
/** A library larger than its head, so a whole-file read would show. */
const LIBRARY_BYTES = 4096;

/** A `File` as `<input webkitdirectory>` returns it: the path starts with the picked folder's name. */
function pickedFile(relativePath: string, bytes: Uint8Array): File {
  const name = relativePath.split('/').at(-1) ?? relativePath;
  const file = new File([new Uint8Array(bytes)], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

/** Records the byte counts each read slices off the file. */
function watchedFile(file: File, reads: number[]): File {
  const slice = file.slice.bind(file);
  Object.defineProperty(file, 'slice', {
    value: (start?: number, end?: number) => {
      reads.push((end ?? file.size) - (start ?? 0));
      return slice(start, end);
    },
  });
  return file;
}

type HandleTree = { readonly [name: string]: HandleTree | File };

/** A fake directory handle that logs every directory it enumerates, by path. */
function directoryHandle(
  name: string,
  tree: HandleTree,
  listed: string[],
  path = name,
): PickedDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      listed.push(path);
      for (const [childName, child] of Object.entries(tree)) {
        if (child instanceof File) {
          const handle: PickedFileHandle = { kind: 'file', name: childName, getFile: async () => child };
          yield handle;
        } else {
          yield directoryHandle(childName, child, listed, `${path}/${childName}`);
        }
      }
    },
  };
}

describe('fileListReader', () => {
  it('recognizes a picked install whatever the casing, below the picked folder name', async () => {
    const reads: number[] = [];
    const library = watchedFile(
      pickedFile('Cultures/DATAX/libs/Data0001.lib', libraryHead({ totalSize: LIBRARY_BYTES })),
      reads,
    );
    const reader = fileListReader([library, pickedFile('Cultures/readme.txt', new Uint8Array(1))]);

    expect(await reader.list([])).toEqual([
      { name: 'DATAX', kind: 'directory' },
      { name: 'readme.txt', kind: 'file', size: 1 },
    ]);
    expect(await findInstall(reader)).toEqual({
      path: [],
      layout: 'library',
      game: undefined,
      edition: undefined,
    });
    expect(reads).toEqual([LIBRARY_HEAD_BYTES]);
  });

  it('finds an install one level below the picked folder', async () => {
    const reader = fileListReader([pickedFile('Games/Northland/DataX/Libs/data0001.lib', libraryHead())]);

    expect((await findInstall(reader))?.path).toEqual(['Northland']);
  });

  it('answers absent paths and folders without game data as no install', async () => {
    const reader = fileListReader([pickedFile('Photos/2024/beach.jpg', new Uint8Array(8))]);

    expect(await reader.list(['nowhere'])).toBeUndefined();
    expect(await reader.readHead(['2024', 'missing.jpg'], LIBRARY_HEAD_BYTES)).toBeUndefined();
    expect(await findInstall(reader)).toBeUndefined();
  });
});

describe('pickedFolderName', () => {
  it('names the folder every path starts with, and nothing for bare file names', () => {
    const picked = [
      pickedFile('Cultures/DataX/Libs/data0001.lib', new Uint8Array(8)),
      pickedFile('Cultures/readme.txt', new Uint8Array(8)),
    ];
    expect(pickedFolderName(picked)).toBe('Cultures');
    expect(pickedFolderName([pickedFile('readme.txt', new Uint8Array(8))])).toBeNull();
    expect(pickedFolderName([])).toBeNull();
  });
});

describe('directoryHandleReader', () => {
  it('recognizes a picked install from file heads and lists only the directories the rule walks', async () => {
    const listed: string[] = [];
    const reads: number[] = [];
    const library = watchedFile(
      new File([new Uint8Array(libraryHead({ totalSize: LIBRARY_BYTES }))], 'data0001.lib'),
      reads,
    );
    const root = directoryHandle(
      'Cultures',
      { DataX: { Libs: { 'data0001.lib': library } }, Music: { Tracks: {} } },
      listed,
    );
    const reader = directoryHandleReader(root);

    expect(await findInstall(reader)).toEqual({
      path: [],
      layout: 'library',
      game: undefined,
      edition: undefined,
    });
    expect(reads).toEqual([LIBRARY_HEAD_BYTES]);
    // Each directory is enumerated once however often the rule lists it; unrelated ones never.
    expect(listed).toEqual(['Cultures', 'Cultures/DataX', 'Cultures/DataX/Libs']);
    expect(await reader.list(['DataX', 'Libs'])).toEqual([
      { name: 'data0001.lib', kind: 'file', size: LIBRARY_BYTES },
    ]);
  });

  it('reads a directory it cannot enumerate as absent', async () => {
    const root: PickedDirectoryHandle = {
      kind: 'directory',
      name: 'Locked',
      values: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('NotAllowedError')) }),
      }),
    };

    expect(await directoryHandleReader(root).list([])).toBeUndefined();
    expect(await findInstall(directoryHandleReader(root))).toBeUndefined();
  });
});
