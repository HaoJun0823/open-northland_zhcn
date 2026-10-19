import { describe, expect, it } from 'vitest';
import {
  createInstalledMapStore,
  INSTALLED_MAP_RECORD_VERSION,
  type InstalledMapRecord,
  installedRecord,
  retainedEntries,
} from '../../src/content/map-source/index.js';
import { memoryInstalledStorage, TINY_FINGERPRINT } from '../support/catalog-maps.js';

const BUDGET = 100;

function record(mapId: string, entryId: string, installedAt: number, size: number): InstalledMapRecord {
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    revision: '00000000-0000-0000-0000-000000000001',
    mapId,
    entryId,
    fingerprint: TINY_FINGERPRINT,
    irVersion: 1,
    languages: ['pol'],
    index: {
      id: mapId,
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      provenance: { kind: 'catalog', folder: entryId },
    },
    installedAt,
    size,
    suffixes: ['.json'],
  };
}
const files = (size: number) => new Map([['.json' as const, new Uint8Array(size)]]);
const install = (item: InstalledMapRecord) => ({ record: item, files: files(item.size) });

describe('installed map records', () => {
  it('reads exactly its own layout', () => {
    const good = record('cn-a', 'cn-a', 1, 1);
    expect(installedRecord(structuredClone(good))).toEqual(good);
    expect(installedRecord({ ...good, version: INSTALLED_MAP_RECORD_VERSION - 1 })).toBeNull();
    expect(installedRecord({ ...good, languages: undefined })).toBeNull();
    expect(installedRecord({ ...good, languages: ['pol', 'xx'] })).toBeNull();
    expect(installedRecord({ ...good, revision: undefined })).toBeNull();
    expect(installedRecord({ ...good, mapId: '../x' })).toBeNull();
    expect(installedRecord({ ...good, suffixes: ['.meta.json'] })).toBeNull();
    expect(installedRecord({ ...good, suffixes: ['.json', '.exe'] })).toBeNull();
    expect(
      installedRecord({ ...good, index: { ...good.index, provenance: { kind: 'mod', folder: 'x' } } }),
    ).toBeNull();
    expect(installedRecord({ ...good, index: { ...good.index, id: 'other' } })).toBeNull();
  });
});

describe('the web budget', () => {
  it('keeps whole entries, newest first, and always the incoming one', () => {
    const stored = [
      record('old', 'old', 1, 40),
      record('mid-1', 'mid', 2, 20),
      record('mid-2', 'mid', 2, 20),
      record('new', 'new', 3, 30),
    ];
    expect([...retainedEntries(stored, [record('in', 'in', 4, 30)], BUDGET)].sort()).toEqual([
      'in',
      'mid',
      'new',
    ]);
    expect(() => retainedEntries(stored, [record('huge', 'huge', 4, BUDGET + 1)], BUDGET)).toThrow(/budget/);
    expect(() => retainedEntries([], [record('a', 'a', 1, 1), record('b', 'b', 1, 1)], BUDGET)).toThrow(
      /one/,
    );
  });
});

describe('an installed map store', () => {
  it('replaces an entry, evicts the least recently installed and removes on request', async () => {
    const { storage, records, files: stored } = memoryInstalledStorage();
    const store = createInstalledMapStore(storage, { budget: BUDGET });
    await store.install('first', [install(record('first', 'first', 1, 50))]);
    await store.install('pack', [
      install(record('pack', 'pack', 2, 30)),
      install(record('pack-2', 'pack', 2, 10)),
    ]);
    await store.install('pack', [install(record('pack', 'pack', 3, 30))]);
    expect([...records.keys()].sort()).toEqual(['first', 'pack']);
    await store.install('big', [install(record('big', 'big', 4, 60))]);
    expect([...records.keys()].sort()).toEqual(['big', 'pack']);
    expect([...stored.keys()].sort()).toEqual(['big.json', 'pack.json']);
    await store.remove('pack');
    expect((await store.list()).map((item) => item.mapId)).toEqual(['big']);
    await expect(store.install('x', [install(record('y', 'y', 5, 1))])).rejects.toThrow(/one entry/);
  });

  it('drops a record it cannot read with its files on the next install', async () => {
    const { storage, records, files: stored } = memoryInstalledStorage();
    records.set('broken', { version: 0, mapId: 'broken' });
    stored.set('broken.json', new Uint8Array(1));
    const store = createInstalledMapStore(storage, { budget: null });
    expect(await store.list()).toEqual([]);
    await store.install('a', [install(record('a', 'a', 1, 1))]);
    expect([...records.keys()]).toEqual(['a']);
    expect(stored.has('broken.json')).toBe(false);
  });

  it('keeps terrain and sidecars on one revision after a replacement', async () => {
    const { storage } = memoryInstalledStorage();
    const store = createInstalledMapStore(storage, { budget: null });
    const first = { ...record('a', 'a', 1, 2), suffixes: ['.json', '.script.json'] as const };
    const pack = (item: InstalledMapRecord, text: string) => ({
      record: item,
      files: new Map(item.suffixes.map((suffix) => [suffix, new TextEncoder().encode(text)])),
    });
    await store.install('a', [pack(first, 'old')]);
    const files = store.fetchFor(first);
    expect(await (await files('/maps/a.json')).text()).toBe('old');
    await store.install('a', [pack({ ...first, installedAt: 2 }, 'new')]);
    expect(await (await files('/maps/a.script.json')).text()).toBe('old');
  });

  it('rejects a stale handle before its first read without eagerly loading files', async () => {
    const { storage } = memoryInstalledStorage();
    let reads = 0;
    const store = createInstalledMapStore(
      {
        ...storage,
        readMap: async (id) => {
          reads++;
          return storage.readMap(id);
        },
      },
      { budget: null },
    );
    const first = record('a', 'a', 1, 1);
    await store.install('a', [install(first)]);
    const files = store.fetchFor(first);
    await store.list();
    expect(reads).toBe(0);
    await store.install('a', [install({ ...first, revision: '00000000-0000-0000-0000-000000000002' })]);
    await expect(files('/maps/a.json')).rejects.toThrow('changed before loading');
    expect(reads).toBe(1);
  });

  it('reads installed bytes through the source fetch', async () => {
    const { storage } = memoryInstalledStorage();
    const kept = createInstalledMapStore(storage, { budget: null });
    await kept.install('a', [
      { record: record('a', 'a', 1, 2), files: new Map([['.json', new Uint8Array([123, 125])]]) },
    ]);
    expect(await (await kept.fetchFor(record('a', 'a', 1, 2))('/maps/a.json')).json()).toEqual({});
  });
});
