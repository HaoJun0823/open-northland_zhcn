import type { DesktopMaps } from '../../view/desktop-bridge.js';
import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import { storedLocalInput } from '../local-import/input.js';
import type { MapFileSuffix } from './files.js';
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

function dropInTxn(txn: IDBTransaction, drop: readonly string[], withFiles: boolean): void {
  for (const mapId of drop) {
    txn.objectStore(RECORDS).delete(mapId);
    if (withFiles) {
      const prefix = `${mapId}.`;
      txn.objectStore(FILES).delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    }
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
      const request = await inDb(FILES, 'readonly', (txn) => txn.objectStore(FILES).get(sourceKey(entryId)));
      return storedLocalInput(request.result);
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
        dropInTxn(txn, drop, true);
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

/** The desktop's storage: files on disk through the shell, records in the page's IndexedDB. A record
 *  is written after its files, so a listed map always has them. */
export function desktopInstalledMapStorage(maps: DesktopMaps): InstalledMapStorage {
  return {
    records: idbRecords,
    readFile: async () => null,
    readSource: async () => null,
    async commit(drop, put, sources) {
      if (sources.put !== undefined || sources.drop.length > 0)
        throw new Error('Local source storage requires desktop import support');
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
