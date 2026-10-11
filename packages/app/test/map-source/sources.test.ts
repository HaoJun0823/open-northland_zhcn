import type { MapsIndexEntry } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { loadTerrainMap } from '../../src/content/map-loader.js';
import {
  createInstalledMapStore,
  createMapSourceRegistry,
  INSTALLED_MAP_RECORD_VERSION,
  type InstalledMapRecord,
  type InstalledMapStore,
  storedMapFetch,
} from '../../src/content/map-source/index.js';
import { subMissionPool } from '../../src/entries/map/sub-missions.js';
import { memoryInstalledStorage, TINY_FINGERPRINT, TINY_MAP } from '../support/catalog-maps.js';

const IR = 9;
const shipped: MapsIndexEntry[] = [
  {
    id: 'wyspa',
    fingerprint: TINY_FINGERPRINT,
    picture: true,
    minimap: true,
    provenance: { kind: 'mod', folder: 'maps/wyspa' },
  },
  { id: 'cn-clash', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false },
];
const page: typeof fetch = async () => new Response(null, { status: 404 });

function record(
  mapId: string,
  entryId: string,
  irVersion = IR,
  extra: Partial<MapsIndexEntry> = {},
): InstalledMapRecord {
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    mapId,
    entryId,
    fingerprint: TINY_FINGERPRINT,
    irVersion,
    index: {
      id: mapId,
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      provenance: { kind: 'catalog', folder: entryId },
      ...extra,
    },
    installedAt: 1,
    size: 10,
    suffixes: ['.json'],
  };
}

async function storeWith(records: readonly InstalledMapRecord[]): Promise<InstalledMapStore> {
  const { storage } = memoryInstalledStorage();
  const store = createInstalledMapStore(storage, { budget: null, files: 'stored' });
  const byEntry = new Map<string, InstalledMapRecord[]>();
  for (const item of records) byEntry.set(item.entryId, [...(byEntry.get(item.entryId) ?? []), item]);
  for (const [entryId, maps] of byEntry) {
    await store.install(
      entryId,
      maps.map((item) => ({
        record: item,
        files: new Map([['.json', new TextEncoder().encode(JSON.stringify(TINY_MAP))]]),
      })),
    );
  }
  return store;
}

describe('the map source layer', () => {
  it('merges installed catalogue maps after the shipped ones, a shipped id winning', async () => {
    const store = await storeWith([
      record('cn-a', 'cn-a'),
      record('cn-clash', 'cn-clash'),
      record('cn-old', 'cn-old', IR - 1),
    ]);
    const registry = createMapSourceRegistry({
      shipped: async () => shipped,
      store: () => store,
      irVersion: IR,
    });
    const sources = await registry.sources();
    expect(sources.map((source) => [source.entry.id, source.catalog?.entryId ?? null, source.stale])).toEqual(
      [
        ['wyspa', null, false],
        ['cn-clash', null, false],
        ['cn-a', 'cn-a', false],
        ['cn-old', 'cn-old', true],
      ],
    );
    expect(sources[2]?.entry.provenance).toEqual({ kind: 'catalog', folder: 'cn-a' });
  });

  it('serves an installed map from its store and every other map from the page', async () => {
    const store = await storeWith([record('cn-a', 'cn-a'), record('cn-old', 'cn-old', IR - 1)]);
    const registry = createMapSourceRegistry({
      shipped: async () => shipped,
      store: () => store,
      irVersion: IR,
    });
    expect(await loadTerrainMap('cn-a', await registry.fetchFor('cn-a', page))).toMatchObject({
      width: 1,
      height: 1,
    });
    // A map converted for another version is never read: it is re-downloaded, not translated.
    expect(await registry.fetchFor('cn-old', page)).toBe(page);
    expect(await registry.fetchFor('wyspa', page)).toBe(page);
    expect(await registry.fetchFor('unknown', page)).toBe(page);
    expect((await registry.find('CN-A'))?.catalog?.entryId).toBe('cn-a');
  });

  it('lists the shipped maps alone when the installed store fails or is missing', async () => {
    const broken: InstalledMapStore = {
      ...(await storeWith([])),
      list: async () => {
        throw new Error('quota');
      },
    };
    for (const store of [broken, null]) {
      const registry = createMapSourceRegistry({
        shipped: async () => shipped,
        store: () => store,
        irVersion: IR,
      });
      expect((await registry.sources()).map((source) => source.entry.id)).toEqual(['wyspa', 'cn-clash']);
    }
  });

  it('reads the installed maps on every call', async () => {
    const store = await storeWith([]);
    const registry = createMapSourceRegistry({
      shipped: async () => shipped,
      store: () => store,
      irVersion: IR,
    });
    expect(await registry.find('cn-new')).toBeNull();
    // Installed while a screen that names maps is open, such as the load list.
    await store.install('cn-new', [
      {
        record: record('cn-new', 'cn-new'),
        files: new Map([['.json', new TextEncoder().encode(JSON.stringify(TINY_MAP))]]),
      },
    ]);
    expect((await registry.find('cn-new'))?.catalog?.entryId).toBe('cn-new');
  });

  it('answers only its own map paths from stored bytes', async () => {
    const files = storedMapFetch('cn-a', async (suffix) =>
      suffix === '.json' ? new Uint8Array([123, 125]) : null,
    );
    const terrain = await files('/maps/cn-a.json');
    expect(terrain.headers.get('content-type')).toBe('application/json');
    expect(await terrain.text()).toBe('{}');
    expect((await files('/maps/cn-a.meta.json')).status).toBe(404);
    expect((await files('/maps/cn-b.json')).status).toBe(404);
    expect((await files('/ir.json')).status).toBe(404);
  });

  it("finds a sub-mission among its own pack's maps, a shipped map's among the shipped ones", async () => {
    const campaign = { campaign: { campaignId: 7, missionId: 2 } };
    const store = await storeWith([
      record('cn-pack-a', 'cn-pack-a'),
      record('cn-pack-a-2', 'cn-pack-a', IR, campaign),
      record('cn-pack-b', 'cn-pack-b'),
      record('cn-pack-b-2', 'cn-pack-b', IR, campaign),
    ]);
    const withShipped = [
      ...shipped,
      { id: 'base-2', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false, ...campaign },
    ];
    const registry = createMapSourceRegistry({
      shipped: async () => withShipped,
      store: () => store,
      irVersion: IR,
    });
    const sources = await registry.sources();
    const ids = (current: string) => subMissionPool(sources, current).map((source) => source.entry.id);
    expect(ids('cn-pack-a')).toEqual(['cn-pack-a', 'cn-pack-a-2']);
    expect(ids('cn-pack-b-2')).toEqual(['cn-pack-b', 'cn-pack-b-2']);
    expect(ids('wyspa')).toEqual(['wyspa', 'cn-clash', 'base-2']);
  });
});
