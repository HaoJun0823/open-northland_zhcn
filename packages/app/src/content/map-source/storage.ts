import type { DesktopMaps } from '../../view/platform/desktop-bridge.js';
import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import { localInputFromDesktop, localInputToDesktop } from '../local-import/desktop.js';
import { storedLocalInput } from '../local-import/input.js';
import { localSourceRecord } from '../local-import/source.js';
import { isMapFileSuffix, type MapFileSuffix } from './files.js';
import type { InstalledMapStorage, SourceChanges } from './store.js';

const DB_NAME = 'open-northland-installed-maps';
const RECORDS = 'records';
const FILES = 'files';

const sourceKey = (entryId: string): string => `source:${entryId}`;

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
    const done = completed(txn);
    try {
      const result = run(txn);
      await done;
      return result;
    } catch (error) {
      try {
        txn.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}

async function idbRecords(): Promise<readonly unknown[]> {
  const request = await inDb(RECORDS, 'readonly', (txn) => txn.objectStore(RECORDS).getAll());
  return request.result;
}

function dropInTxn(txn: IDBTransaction, drop: readonly string[]): void {
  for (const mapId of drop) {
    txn.objectStore(RECORDS).delete(mapId);
    const prefix = `${mapId}.`;
    txn.objectStore(FILES).delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  }
}

function sourceChanges(txn: IDBTransaction, changes: SourceChanges): void {
  for (const entryId of changes.drop) {
    txn.objectStore(RECORDS).delete(sourceKey(entryId));
    txn.objectStore(FILES).delete(sourceKey(entryId));
  }
  if (changes.put !== undefined) {
    const { record, input } = changes.put;
    txn.objectStore(RECORDS).put(record, sourceKey(record.entryId));
    txn.objectStore(FILES).put(input, sourceKey(record.entryId));
  }
}

/** The web build's storage: records and files in one IndexedDB, committed in one transaction. */
export function browserInstalledMapStorage(): InstalledMapStorage {
  return {
    records: idbRecords,
    async readSource(entryId) {
      const requests = await inDb([RECORDS, FILES], 'readonly', (txn) => ({
        record: txn.objectStore(RECORDS).get(sourceKey(entryId)),
        input: txn.objectStore(FILES).get(sourceKey(entryId)),
      }));
      const record = localSourceRecord(requests.record.result);
      const input = storedLocalInput(requests.input.result);
      return record === null || input === null ? null : { record, input };
    },
    async readMap(mapId) {
      const prefix = `${mapId}.`;
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const requests = await inDb([RECORDS, FILES], 'readonly', (txn) => ({
        record: txn.objectStore(RECORDS).get(mapId),
        keys: txn.objectStore(FILES).getAllKeys(range),
        values: txn.objectStore(FILES).getAll(range),
      }));
      const files = new Map<MapFileSuffix, Uint8Array>();
      requests.keys.result.forEach((key, i) => {
        const suffix = typeof key === 'string' ? key.slice(mapId.length) : null;
        const value: unknown = requests.values.result[i];
        if (!isMapFileSuffix(suffix)) return;
        if (value instanceof Uint8Array) files.set(suffix, value);
        else if (value instanceof ArrayBuffer) files.set(suffix, new Uint8Array(value));
      });
      return { record: requests.record.result, files };
    },
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
    async commit(drop, put, sources) {
      await inDb([RECORDS, FILES], 'readwrite', (txn) => {
        dropInTxn(txn, drop);
        sourceChanges(txn, sources);
        for (const { record, files } of put) {
          for (const [suffix, bytes] of files)
            txn.objectStore(FILES).put(bytes, fileKey(record.mapId, suffix));
          txn.objectStore(RECORDS).put(record, record.mapId);
        }
      });
    },
  };
}

/** The shell commits metadata and file generations together, outside browser quota. */
export function desktopInstalledMapStorage(maps: DesktopMaps): InstalledMapStorage {
  return {
    records: () => maps.list(),
    async readMap(mapId) {
      const snapshot = await maps.readMap(mapId);
      const files = new Map<MapFileSuffix, Uint8Array>();
      for (const [suffix, bytes] of snapshot.files) if (isMapFileSuffix(suffix)) files.set(suffix, bytes);
      return { record: snapshot.record, files };
    },
    async readFile(mapId, suffix) {
      return maps.readFile(mapId, suffix);
    },
    async readSource(entryId) {
      const source = await maps.readSource(entryId);
      if (source === null) return null;
      const record = localSourceRecord(source.record);
      if (record === null) return null;
      return { record, input: localInputFromDesktop(source.input) };
    },
    async commit(drop, put, sources) {
      await maps.commit(
        drop,
        put.map(({ record, files }) => ({ record, files: [...files] })),
        {
          drop: sources.drop,
          ...(sources.put === undefined
            ? {}
            : { put: { record: sources.put.record, input: await localInputToDesktop(sources.put.input) } }),
          ...(sources.expected === undefined ? {} : { expected: sources.expected }),
        },
      );
    },
  };
}
