import type { MapsIndexEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { diag } from '../../diag/log.js';
import { loadMapList } from '../map/maps-index.js';
import { type ContentFetch, contentFetch } from '../url.js';
import type { InstalledMapRecord } from './installed.js';
import { type InstalledMapStore, installedMapStore } from './store.js';

/** What an installed map remembers of the conversion it came from. */
export interface InstalledMapRef {
  readonly entryId: string;
  readonly fingerprint: string;
  readonly irVersion: number;
}

/** One map the game knows of, and where its files load from. */
export interface MapSource {
  /** The listing row, retaining the map's original provenance. */
  readonly entry: MapsIndexEntry;
  /** Present on an installed catalogue map. */
  readonly catalog?: InstalledMapRef;
  /** Present on an imported map; user maps travel through the relay, never an API reference. */
  readonly local?: InstalledMapRef;
  /** Converted for another content version: must be rebuilt or downloaded before playing. */
  readonly stale: boolean;
  /** Serves the map's `/maps/<id><suffix>` paths. */
  readonly fetch: ContentFetch;
  /** Where the authored picture shows from, when not `/maps/<id>.png`. */
  readonly pictureUrl?: string;
}

/** An installed record with what its store resolved for it. */
export interface InstalledSource {
  readonly record: InstalledMapRecord;
  readonly fetch: ContentFetch;
  readonly pictureUrl: string | null;
}

/**
 * The shipped index joined with installed maps. A shipped map wins over an installed one
 * with the same id, which the API's own id prefix keeps from happening.
 */
export function mergeMapSources(
  shipped: readonly MapsIndexEntry[],
  installed: readonly InstalledSource[],
  irVersion: number,
  shippedFetch: ContentFetch,
): readonly MapSource[] {
  const ids = new Set(shipped.map((entry) => entry.id.toLowerCase()));
  const sources: MapSource[] = shipped.map((entry) => ({ entry, stale: false, fetch: shippedFetch }));
  for (const { record, fetch: files, pictureUrl } of installed) {
    if (ids.has(record.mapId.toLowerCase())) continue;
    ids.add(record.mapId.toLowerCase());
    sources.push({
      entry: record.index,
      [record.index.provenance?.kind === 'user' ? 'local' : 'catalog']: {
        entryId: record.entryId,
        fingerprint: record.fingerprint,
        irVersion: record.irVersion,
      },
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
  /** Every known map, including those still awaiting a rebuild or download. Read fresh on each call: an install from
   *  the catalogue screen shows in the next list. */
  sources(): Promise<readonly MapSource[]>;
  find(mapId: string): Promise<MapSource | null>;
  /** The fetch that serves `mapId`'s files: its installed store's, else `fallback` (the page origin). */
  fetchFor(mapId: string, fallback?: ContentFetch): Promise<ContentFetch>;
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
  const sources = async (shippedFetch: ContentFetch = contentFetch) => {
    const [listed, local] = await Promise.all([deps.shipped(), installed()]);
    return mergeMapSources(listed, local, deps.irVersion, shippedFetch);
  };
  return {
    sources: () => sources(),
    async find(mapId) {
      const key = mapId.toLowerCase();
      return (await sources()).find((source) => source.entry.id.toLowerCase() === key) ?? null;
    },
    async fetchFor(mapId, fallback = contentFetch) {
      const key = mapId.toLowerCase();
      const source = (await sources(fallback)).find((item) => item.entry.id.toLowerCase() === key);
      return source !== undefined &&
        (source.catalog !== undefined || source.local !== undefined) &&
        !source.stale
        ? source.fetch
        : fallback;
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
export const mapFetch = (mapId: string, fallback?: ContentFetch): Promise<ContentFetch> =>
  registry.fetchFor(mapId, fallback);

/** The maps a menu may offer: every source converted for this content version. */
export async function playableMapSources(): Promise<readonly MapSource[]> {
  return (await loadMapSources()).filter((source) => !source.stale);
}
