import { type DesktopMaps, desktopMaps } from '../../view/desktop-bridge.js';
import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import { isMapId } from '../transfer/documents.js';
import {
  MAP_FILE_SUFFIXES,
  type MapFileSuffix,
  mapFileContentType,
  mapFilePath,
  storedMapFetch,
} from './files.js';
import {
  type InstallableMap,
  type InstalledMapRecord,
  installedRecord,
  MAX_INSTALLED_MAP_BYTES,
  retainedEntries,
} from './installed.js';

/** The raw storage under an installed-map store: records, and the files where the store keeps them. */
export interface InstalledMapStorage {
  records(): Promise<readonly unknown[]>;
  readFile(mapId: string, suffix: MapFileSuffix): Promise<Uint8Array | null>;
  /** Drops the named maps' records and files, then stores the new maps, as one step where it can. */
  commit(drop: readonly string[], put: readonly InstallableMap[]): Promise<void>;
}

export interface InstalledMapStore {
  list(): Promise<readonly InstalledMapRecord[]>;
  /** Stores one catalogue entry's maps, replacing that entry's earlier install. */
  install(entryId: string, maps: readonly InstallableMap[]): Promise<void>;
  remove(entryId: string): Promise<void>;
  /** A fetch that serves the map's `/maps/` paths. */
  fetchFor(record: InstalledMapRecord): typeof fetch;
  /** Where the map's authored picture shows from, or null when it has none. */
  pictureUrl(record: InstalledMapRecord): Promise<string | null>;
}

export interface InstalledMapStoreOptions {
  /** Bytes the store may hold before evicting whole entries; null keeps everything. */
  readonly budget: number | null;
  /** `served`: the host serves the files under `/maps/`; `stored`: the store answers them itself. */
  readonly files: 'served' | 'stored';
}

const PICTURE: MapFileSuffix = '.png';

function rawMapId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const mapId = (raw as Record<string, unknown>).mapId;
  return typeof mapId === 'string' && isMapId(mapId) ? mapId : null;
}

export function createInstalledMapStore(
  storage: InstalledMapStorage,
  options: InstalledMapStoreOptions,
): InstalledMapStore {
  // One object URL per stored picture, so a list redrawn after an install does not leak them.
  const pictures = new Map<string, Promise<string | null>>();
  const read = async () => {
    const raw = await storage.records();
    const valid: InstalledMapRecord[] = [];
    const broken: string[] = [];
    for (const item of raw) {
      const record = installedRecord(item);
      if (record !== null) valid.push(record);
      else {
        const mapId = rawMapId(item);
        if (mapId !== null) broken.push(mapId);
      }
    }
    return { valid, broken };
  };
  return {
    async list() {
      return (await read()).valid;
    },
    async install(entryId, maps) {
      if (maps.some((map) => map.record.entryId !== entryId))
        throw new Error('Install mixes catalogue entries');
      const { valid, broken } = await read();
      const keep =
        options.budget === null
          ? null
          : retainedEntries(
              valid,
              maps.map((map) => map.record),
              options.budget,
            );
      const drop = valid
        .filter((record) => record.entryId === entryId || (keep !== null && !keep.has(record.entryId)))
        .map((record) => record.mapId);
      await storage.commit([...drop, ...broken], maps);
    },
    async remove(entryId) {
      const { valid, broken } = await read();
      const drop = valid.filter((record) => record.entryId === entryId).map((record) => record.mapId);
      await storage.commit([...drop, ...broken], []);
    },
    fetchFor(record) {
      if (options.files === 'served') return fetch;
      return storedMapFetch(record.mapId, (suffix) =>
        record.suffixes.includes(suffix) ? storage.readFile(record.mapId, suffix) : Promise.resolve(null),
      );
    },
    pictureUrl(record) {
      if (!record.suffixes.includes(PICTURE)) return Promise.resolve(null);
      if (options.files === 'served') return Promise.resolve(mapFilePath(record.mapId, PICTURE));
      const key = `${record.mapId}:${record.installedAt}`;
      let url = pictures.get(key);
      if (url === undefined) {
        url = storage
          .readFile(record.mapId, PICTURE)
          .then((bytes) =>
            bytes === null
              ? null
              : URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mapFileContentType(PICTURE) })),
          );
        pictures.set(key, url);
      }
      return url;
    },
  };
}

const DB_NAME = 'open-northland-installed-maps';
const RECORDS = 'records';
const FILES = 'files';

const fileKey = (mapId: string, suffix: MapFileSuffix): string => `${mapId}${suffix}`;

async function inDb<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (txn: IDBTransaction) => T,
): Promise<T> {
  const db = await openDb(DB_NAME, (created) => {
    created.createObjectStore(RECORDS);
    created.createObjectStore(FILES);
  });
  try {
    const txn = db.transaction(stores, mode);
    const result = run(txn);
    await completed(txn);
    return result;
  } finally {
    db.close();
  }
}

async function idbRecords(): Promise<readonly unknown[]> {
  const request = await inDb(RECORDS, 'readonly', (txn) => txn.objectStore(RECORDS).getAll());
  return request.result;
}

function dropInTxn(txn: IDBTransaction, drop: readonly string[], withFiles: boolean): void {
  for (const mapId of drop) {
    txn.objectStore(RECORDS).delete(mapId);
    if (withFiles)
      for (const suffix of MAP_FILE_SUFFIXES) txn.objectStore(FILES).delete(fileKey(mapId, suffix));
  }
}

/** The web build's storage: records and files in one IndexedDB, committed in one transaction. */
export function browserInstalledMapStorage(): InstalledMapStorage {
  return {
    records: idbRecords,
    async readFile(mapId, suffix) {
      const request = await inDb(FILES, 'readonly', (txn) =>
        txn.objectStore(FILES).get(fileKey(mapId, suffix)),
      );
      const value: unknown = request.result;
      return value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
    },
    async commit(drop, put) {
      await inDb([RECORDS, FILES], 'readwrite', (txn) => {
        dropInTxn(txn, drop, true);
        for (const { record, files } of put) {
          for (const [suffix, bytes] of files)
            txn.objectStore(FILES).put(bytes, fileKey(record.mapId, suffix));
          txn.objectStore(RECORDS).put(record, record.mapId);
        }
      });
    },
  };
}

/** The desktop's storage: files on disk through the shell, records in the page's IndexedDB. A record
 *  is written after its files, so a listed map always has them. */
export function desktopInstalledMapStorage(maps: DesktopMaps): InstalledMapStorage {
  return {
    records: idbRecords,
    readFile: async () => null,
    async commit(drop, put) {
      await inDb(RECORDS, 'readwrite', (txn) => dropInTxn(txn, drop, false));
      for (const mapId of drop) await maps.remove(mapId);
      for (const { record, files } of put) {
        for (const [suffix, bytes] of files) await maps.writeFile(record.mapId, suffix, bytes);
      }
      await inDb(RECORDS, 'readwrite', (txn) => {
        for (const { record } of put) txn.objectStore(RECORDS).put(record, record.mapId);
      });
    },
  };
}

let platformStore: InstalledMapStore | null | undefined;

/** The installed-map store of the platform the page runs on, or null where IndexedDB is missing. */
export function installedMapStore(): InstalledMapStore | null {
  if (platformStore !== undefined) return platformStore;
  if (typeof indexedDB === 'undefined') {
    platformStore = null;
    return null;
  }
  const desktop = desktopMaps();
  platformStore =
    desktop === null
      ? createInstalledMapStore(browserInstalledMapStorage(), {
          budget: MAX_INSTALLED_MAP_BYTES,
          files: 'stored',
        })
      : createInstalledMapStore(desktopInstalledMapStorage(desktop), { budget: null, files: 'served' });
  return platformStore;
}
