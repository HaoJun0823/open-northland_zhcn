import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesktopMapStore } from '../../src/maps/store.js';

const pack = (mapId: string, text: string) => ({
  record: { mapId, revision: randomUUID() },
  files: [['.json', new TextEncoder().encode(text)]] as const,
});

describe('desktop installed packs', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'on-map-store-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('publishes a whole pack and its records, survives restart, and removes it', async () => {
    const store = createDesktopMapStore(root);
    const first = pack('cn-a', 'old');
    await store.commit([], [first]);
    const snapshot = await store.readMap('cn-a');
    expect(await store.readFile('cn-a', '.json')).toEqual(first.files[0][1]);
    expect(await store.readFile('cn-a', '.png')).toBeNull();
    expect(() => store.readFile('cn-a', '/../escape')).toThrow(/suffix/);
    const second = pack('cn-a', 'new');
    const other = pack('cn-b', 'other');
    await store.commit(['cn-a'], [second, other]);
    expect(snapshot.files).toEqual(first.files);
    const restarted = createDesktopMapStore(root);
    expect(await restarted.list()).toEqual([second.record, other.record]);
    expect((await restarted.readMap('cn-a')).files).toEqual(second.files);
    expect(await readdir(join(root, 'files'))).toHaveLength(2);
    await restarted.commit(['cn-a', 'cn-b'], []);
    expect(await restarted.list()).toEqual([]);
    expect(await readdir(join(root, 'files'))).toEqual([]);
  });

  it('reads a thumbnail without opening unrelated terrain files', async () => {
    const store = createDesktopMapStore(root);
    const map = pack('cn-a', 'terrain');
    const png = new Uint8Array([137, 80, 78, 71]);
    await store.commit([], [{ ...map, files: [...map.files, ['.png', png]] }]);
    const [folder] = await readdir(join(root, 'files'));
    if (folder === undefined) throw new Error('Missing installed generation');
    await rm(join(root, 'files', folder, 'cn-a.json'));
    expect(await store.readFile('cn-a', '.png')).toEqual(png);
    await expect(store.readMap('cn-a')).rejects.toThrow();
  });

  it('retains the previous pack if publishing metadata fails after writing new files', async () => {
    const store = createDesktopMapStore(root);
    const original = pack('cn-a', 'old');
    await store.commit([], [original]);
    await mkdir(join(root, 'installed.json.partial'));
    await expect(store.commit(['cn-a'], [pack('cn-a', 'new'), pack('cn-b', 'other')])).rejects.toThrow();
    expect(await createDesktopMapStore(root).list()).toEqual([original.record]);
    expect((await store.readMap('cn-a')).files).toEqual(original.files);
    expect(await readdir(join(root, 'files'))).toHaveLength(1);
    await rm(join(root, 'installed.json.partial'), { recursive: true });
    await store.commit(['cn-a'], [pack('cn-b', 'next')]);
    expect((await store.readMap('cn-a')).record).toBeNull();
  });

  it('serializes concurrent replacements and validates the complete batch before changing disk', async () => {
    const store = createDesktopMapStore(root);
    const a = pack('cn-a', 'a');
    const b = pack('cn-b', 'b');
    await Promise.all([store.commit([], [a]), store.commit([], [b])]);
    expect(await store.list()).toEqual([a.record, b.record]);
    expect(() => store.commit(['../escape'], [])).toThrow(/map id/);
    expect(() => store.commit([], [a, a])).toThrow(/Duplicate/);
    expect(() => store.commit([], [{ ...a, files: [['/escape.json', new Uint8Array([1])]] }])).toThrow(
      /suffix/,
    );
    expect(await store.list()).toEqual([a.record, b.record]);
  });
});

it('commits source and map generations atomically, guards stale rebuilds, and survives relaunch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'on-desktop-source-'));
  try {
    const store = createDesktopMapStore(root);
    const source = {
      record: {
        kind: 'local-source',
        version: 1,
        entryId: 'user-test',
        name: 'test.zip',
        fingerprint: 'a'.repeat(64),
        size: 3,
        maps: [{ folder: 'test', mapId: 'user-test-1' }],
      },
      input: { kind: 'archive', name: 'test.zip', bytes: new Uint8Array([1, 2, 3]) },
    };
    const original = pack('user-test-1', 'old');
    await store.commit([], [original], { drop: [], put: source });
    expect(await createDesktopMapStore(root).readSource('user-test')).toEqual(source);
    expect(await store.list()).toEqual([original.record, source.record]);
    await mkdir(join(root, 'installed.json.partial'));
    await expect(
      store.commit(['user-test-1'], [pack('user-test-1', 'new')], {
        drop: ['user-test'],
        put: { ...source, input: { ...source.input, bytes: new Uint8Array([4, 5, 6]) } },
      }),
    ).rejects.toThrow();
    expect(await store.readSource('user-test')).toEqual(source);
    expect((await store.readMap('user-test-1')).record).toEqual(original.record);
    await rm(join(root, 'installed.json.partial'), { recursive: true });
    await expect(
      store.commit([], [], { drop: [], expected: { ...source.record, fingerprint: 'b'.repeat(64) } }),
    ).rejects.toThrow(/changed/);
    await store.commit(['user-test-1'], [], { drop: ['user-test'] });
    expect(await store.readSource('user-test')).toBeNull();
    expect(await readdir(join(root, 'files'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('discards obsolete catalogue-only manifests but refuses damaged current source storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'on-desktop-obsolete-'));
  try {
    await writeFile(
      join(root, 'installed.json'),
      JSON.stringify({ version: 1, maps: [{ invalid: 'old schema must not be interpreted' }] }),
    );
    const store = createDesktopMapStore(root);
    expect(await store.list()).toEqual([]);
    const map = pack('catalogue-reinstall', 'terrain');
    await store.commit([], [map]);
    expect((await createDesktopMapStore(root).readMap('catalogue-reinstall')).record).toEqual(map.record);
    await writeFile(join(root, 'installed.json'), JSON.stringify({ version: 2, maps: [] }));
    await expect(createDesktopMapStore(root).list()).rejects.toThrow(/manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
