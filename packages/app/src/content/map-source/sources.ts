import type { MapsIndexEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { diag } from '../../diag/log.js';
import { loadMapList } from '../maps-index.js';
import type { InstalledMapRecord } from './installed.js';
import { type InstalledMapStore, installedMapStore } from './store.js';

/** What an installed catalogue map remembers of the conversion it came from. */
export interface CatalogMapRef {
  readonly entryId: string;
  readonly fingerprint: string;
  readonly irVersion: number;
}

/** One map the game knows of, and where its files load from. */
export interface MapSource {
  /** The listing row; an installed catalogue map's carries `provenance.kind` `catalog`. */
  readonly entry: MapsIndexEntry;
  /** Present on an installed catalogue map. */
  readonly catalog?: CatalogMapRef;
  /** Converted for another content version: listed for re-download, never played. */
  readonly stale: boolean;
  /** Serves the map's `/maps/<id><suffix>` paths. */
  readonly fetch: typeof fetch;
  /** Where the authored picture shows from, when not `/maps/<id>.png`. */
  readonly pictureUrl?: string;
}

/** An installed record with what its store resolved for it. */
export interface InstalledSource {
  readonly record: InstalledMapRecord;
  readonly fetch: typeof fetch;
  readonly pictureUrl: string | null;
}

/**
 * The shipped index joined with the installed catalogue maps. A shipped map wins over an installed one
 * with the same id, which the API's own id prefix keeps from happening.
 */
export function mergeMapSources(
  shipped: readonly MapsIndexEntry[],
  installed: readonly InstalledSource[],
  irVersion: number,
  shippedFetch: typeof fetch,
): readonly MapSource[] {
  const ids = new Set(shipped.map((entry) => entry.id.toLowerCase()));
  const sources: MapSource[] = shipped.map((entry) => ({ entry, stale: false, fetch: shippedFetch }));
  for (const { record, fetch: files, pictureUrl } of installed) {
    if (ids.has(record.mapId.toLowerCase())) continue;
    ids.add(record.mapId.toLowerCase());
    sources.push({
      entry: record.index,
      catalog: { entryId: record.entryId, fingerprint: record.fingerprint, irVersion: record.irVersion },
      stale: record.irVersion !== irVersion,
      fetch: files,
      ...(pictureUrl === null ? {} : { pictureUrl }),
    });
  }
  return sources;
}

export interface MapSourceDeps {
  readonly shipped: () => Promise<readonly MapsIndexEntry[]>;
  readonly store: () => InstalledMapStore | null;
  readonly irVersion: number;
}

export interface MapSourceRegistry {
  /** Every known map, the stale catalogue ones included. Read fresh on each call: an install from
   *  the catalogue screen shows in the next list. */
  sources(): Promise<readonly MapSource[]>;
  find(mapId: string): Promise<MapSource | null>;
  /** The fetch that serves `mapId`'s files: its installed store's, else `fallback` (the page origin). */
  fetchFor(mapId: string, fallback?: typeof fetch): Promise<typeof fetch>;
}

export function createMapSourceRegistry(deps: MapSourceDeps): MapSourceRegistry {
  const installed = async (): Promise<readonly InstalledSource[]> => {
    const store = deps.store();
    if (store === null) return [];
    try {
      const records = await store.list();
      return await Promise.all(
        records.map(async (record) => ({
          record,
          fetch: store.fetchFor(record),
          pictureUrl: await store.pictureUrl(record),
        })),
      );
    } catch (error) {
      diag.warn('content', 'installed maps unavailable', { error: String(error) });
      return [];
    }
  };
  const sources = async (shippedFetch: typeof fetch = fetch) => {
    const [shipped, local] = await Promise.all([deps.shipped(), installed()]);
    return mergeMapSources(shipped, local, deps.irVersion, shippedFetch);
  };
  return {
    sources: () => sources(),
    async find(mapId) {
      const key = mapId.toLowerCase();
      return (await sources()).find((source) => source.entry.id.toLowerCase() === key) ?? null;
    },
    async fetchFor(mapId, fallback = fetch) {
      const key = mapId.toLowerCase();
      const source = (await sources(fallback)).find((item) => item.entry.id.toLowerCase() === key);
      return source !== undefined && source.catalog !== undefined && !source.stale ? source.fetch : fallback;
    },
  };
}

const registry = createMapSourceRegistry({
  shipped: () => loadMapList(),
  store: installedMapStore,
  irVersion: IR_VERSION,
});

export const loadMapSources = (): Promise<readonly MapSource[]> => registry.sources();
export const findMapSource = (mapId: string): Promise<MapSource | null> => registry.find(mapId);
/** The fetch the map loaders read `mapId` through. */
export const mapFetch = (mapId: string, fallback?: typeof fetch): Promise<typeof fetch> =>
  registry.fetchFor(mapId, fallback);

/** The maps a menu may offer: every source except a catalogue map converted for another version. */
export async function playableMapSources(): Promise<readonly MapSource[]> {
  return (await loadMapSources()).filter((source) => !source.stale);
}
