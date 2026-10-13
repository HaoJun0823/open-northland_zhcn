import type { InstalledMapStore } from '../map-source/store.js';
import { convertLocalMap, type LocalImportOptions } from './client.js';
import type { LocalMapInput } from './input.js';

export interface LocalInstallOptions extends LocalImportOptions {
  readonly store: InstalledMapStore;
  readonly convert?: typeof convertLocalMap;
  readonly now?: () => number;
  readonly onSaving?: () => void;
}

/** Storage may finish after cancellation; its result must not start a conversion. */
async function readForImport<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (signal === undefined) return read();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return read();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Nothing is written until conversion finishes. The web store replaces input and output atomically. */
export async function installLocalMap(input: LocalMapInput, options: LocalInstallOptions) {
  const knownSources = await readForImport(() => options.store.sources(), options.signal);
  options.signal?.throwIfAborted();
  const prepared = await (options.convert ?? convertLocalMap)(
    { input, installedAt: (options.now ?? Date.now)(), knownSources },
    options,
  );
  options.signal?.throwIfAborted();
  options.onSaving?.();
  await options.store.install(prepared.source.record.entryId, prepared.maps, prepared.source);
  return prepared;
}

/** Rebuilds from retained input, never from an older generated schema, preserving map ids. */
export async function reconvertLocalMap(entryId: string, options: LocalInstallOptions) {
  const source = await readForImport(() => options.store.readSource(entryId), options.signal);
  options.signal?.throwIfAborted();
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
