import { IR_VERSION } from '@open-northland/data/ir-version';
import type { InstalledMapRecord } from '../map-source/installed.js';
import type { InstalledMapStore } from '../map-source/store.js';
import { convertLocalMap, type LocalImportOptions } from './client.js';
import type { LocalMapInput } from './input.js';

export interface LocalInstallOptions extends LocalImportOptions {
  readonly store: InstalledMapStore;
  readonly convert?: typeof convertLocalMap;
  readonly now?: () => number;
  readonly onSaving?: () => void;
}

/** Nothing is written until conversion finishes. The web store replaces input and output atomically. */
export async function installLocalMap(input: LocalMapInput, options: LocalInstallOptions) {
  const prepared = await (options.convert ?? convertLocalMap)(
    { input, installedAt: (options.now ?? Date.now)(), knownSources: await options.store.sources() },
    options,
  );
  options.signal?.throwIfAborted();
  options.onSaving?.();
  await options.store.install(prepared.source.record.entryId, prepared.maps, prepared.source);
  return prepared;
}

/** Rebuilds from retained input, never from an older generated schema, preserving map ids. */
export async function reconvertLocalMap(entryId: string, options: LocalInstallOptions) {
  const source = await options.store.readSource(entryId);
  if (source === null) throw new Error('Local map source is unavailable');
  const prepared = await (options.convert ?? convertLocalMap)(
    { input: source.input, previous: source.record, installedAt: (options.now ?? Date.now)() },
    options,
  );
  options.signal?.throwIfAborted();
  options.onSaving?.();
  await options.store.install(entryId, prepared.maps, prepared.source, source.record);
  return prepared;
}

/** Sources can still be listed when this build cannot read their old map-index schema. */
export async function staleLocalEntries(
  store: InstalledMapStore,
  irVersion = IR_VERSION,
): Promise<readonly string[]> {
  const [sources, records] = await Promise.all([store.sources(), store.list()]);
  const byId = new Map<string, InstalledMapRecord>(records.map((record) => [record.mapId, record]));
  return sources
    .filter((source) => source.maps.some((map) => byId.get(map.mapId)?.irVersion !== irVersion))
    .map((source) => source.entryId);
}

const attempted = new WeakMap<InstalledMapStore, Set<string>>();
const restorations = new WeakMap<InstalledMapStore, Promise<void>>();
/** Share one rebuild across concurrent menu/runtime source lookups. Failed sources remain removable. */
export async function restoreLocalMaps(
  store: InstalledMapStore,
  options: Pick<LocalInstallOptions, 'convert'> = {},
): Promise<void> {
  const pending = restorations.get(store);
  if (pending !== undefined) return pending;
  const restoring = (async () => {
    let seen = attempted.get(store);
    if (seen === undefined) {
      seen = new Set();
      attempted.set(store, seen);
    }
    const sources = await store.sources();
    for (const entryId of await staleLocalEntries(store)) {
      const source = sources.find((item) => item.entryId === entryId);
      if (source === undefined) continue;
      const key = `${entryId}:${source.fingerprint}:${IR_VERSION}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await reconvertLocalMap(entryId, { ...options, store });
      } catch {
        /* The catalogue offers an explicit retry for this retained source. */
      }
    }
  })();
  restorations.set(store, restoring);
  try {
    await restoring;
  } finally {
    restorations.delete(store);
  }
}
