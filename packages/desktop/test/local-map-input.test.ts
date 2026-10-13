import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_IMPORT_LIMITS } from '@open-northland/map-import/input';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createLocalMapPicker, parseLocalMapBytes, readPickedMap } from '../src/local-map-input.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'on-native-pick-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

it('reads selected archive bytes and only relevant folder files, refusing symlinks', async () => {
  await mkdir(join(root, 'map'));
  await writeFile(join(root, 'map', 'map.dat'), new Uint8Array([1, 2]));
  await writeFile(join(root, 'map', 'ignored.exe'), 'ignored');
  const input = await readPickedMap(join(root, 'map'), 'folder', new AbortController().signal);
  expect(input).toEqual({
    kind: 'folder',
    name: 'map',
    files: [{ path: 'map.dat', bytes: new Uint8Array([1, 2]) }],
  });
  await symlink(join(root, 'map', 'map.dat'), join(root, 'link.zip'));
  await expect(
    readPickedMap(join(root, 'link.zip'), 'archive', new AbortController().signal),
  ).rejects.toThrow(/links/);
  await symlink(join(root, 'map'), join(root, 'map', 'linked'));
  await expect(readPickedMap(join(root, 'map'), 'folder', new AbortController().signal)).rejects.toThrow(
    /links/,
  );
});

it('rejects oversized sparse archives before allocating their bytes', async () => {
  const path = join(root, 'large.zip');
  await writeFile(path, '');
  await truncate(path, DEFAULT_IMPORT_LIMITS.archiveBytes + 1);
  const picker = createLocalMapPicker(async () => path);
  expect(await picker.pick('archive')).toMatchObject({ kind: 'failed', failure: 'too-large' });
});

it('cancels a pending dialog without reading the selected path', async () => {
  let select: ((path: string) => void) | undefined;
  const picker = createLocalMapPicker(
    () =>
      new Promise((resolve) => {
        select = resolve;
      }),
  );
  const pending = picker.pick('folder');
  picker.cancel();
  select?.('/does/not/exist');
  expect(await pending).toEqual({ kind: 'cancelled' });
  await expect(picker.pick('../folder')).rejects.toThrow(/kind/);
});

it('rejects unsafe and colliding source paths before persistence', () => {
  const input = (paths: string[]) => ({
    kind: 'folder',
    name: 'map',
    files: paths.map((path) => ({ path, bytes: new Uint8Array([1]) })),
  });
  for (const path of ['../map.dat', '/map.dat', 'C:map.dat', 'x\0/map.dat'])
    expect(() => parseLocalMapBytes(input([path]))).toThrow();
  expect(() => parseLocalMapBytes(input(['map.dat', 'MAP.DAT']))).toThrow();
});

it.skipIf(process.platform === 'win32')('refuses a named pipe without waiting for a writer', async () => {
  const path = join(root, 'pipe.zip');
  execFileSync('mkfifo', [path]);
  const picker = createLocalMapPicker(async () => path);
  expect(await picker.pick('archive')).toMatchObject({ kind: 'failed', failure: 'read-failed' });
});
