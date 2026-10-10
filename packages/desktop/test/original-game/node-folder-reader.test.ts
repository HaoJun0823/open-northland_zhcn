import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFolderReader } from '../../src/original-game/node-folder-reader.js';
import { libraryHead } from './fixture.js';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'original-reader-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('nodeFolderReader', () => {
  it('lists files with sizes and directories', async () => {
    await mkdir(join(root, 'DataX', 'Libs'), { recursive: true });
    await writeFile(join(root, 'DataX', 'Libs', 'data0001.lib'), libraryHead());
    const reader = nodeFolderReader(root);
    expect(await reader.list([])).toEqual([{ name: 'DataX', kind: 'directory' }]);
    expect(await reader.list(['DataX', 'Libs'])).toEqual([
      { name: 'data0001.lib', kind: 'file', size: libraryHead().length },
    ]);
  });

  it('reads only the head it is asked for, fewer at the end of a file', async () => {
    await writeFile(join(root, 'short.bin'), new Uint8Array([1, 2, 3]));
    const reader = nodeFolderReader(root);
    expect(await reader.readHead(['short.bin'], 2)).toEqual(new Uint8Array([1, 2]));
    expect(await reader.readHead(['short.bin'], 8)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('answers undefined for anything missing', async () => {
    const reader = nodeFolderReader(join(root, 'absent'));
    expect(await reader.list([])).toBeUndefined();
    expect(await reader.readHead(['nothing.lib'], 4)).toBeUndefined();
  });
});
