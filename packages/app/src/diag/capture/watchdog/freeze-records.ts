import { completed, openDb } from '../../../view/runtime/save-load/idb.js';
import type { CaptureContext } from '../context.js';

/** A main-thread freeze the watchdog saw begin and not yet end. A record still here at the next start
 *  is a page that never came back: the tab was closed or killed while frozen. */
export interface FreezeRecord {
  /** The report's id. */
  readonly id: string;
  /** The session marker of the page that froze. */
  readonly tabId: string;
  /** Epoch milliseconds of the page's last heartbeat. */
  readonly frozenAt: number;
  /** How long the page had been silent when the record was made. */
  readonly silentMs: number;
  /** Epoch milliseconds the watchdog last rewrote the record: it does while the freeze lasts, so a
   *  record seen recently belongs to a tab still frozen, not to one that was closed. */
  readonly seenAt: number;
  readonly context: CaptureContext;
}

const DB_NAME = 'open-northland-freezes';
const STORE = 'freezes';

function open(): Promise<IDBDatabase> {
  return openDb(DB_NAME, (db) => {
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
  });
}

async function write(change: (store: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    const txn = db.transaction(STORE, 'readwrite');
    change(txn.objectStore(STORE));
    await completed(txn);
  } finally {
    db.close();
  }
}

export function putFreezeRecord(record: FreezeRecord): Promise<void> {
  return write((store) => store.put(record));
}

export function deleteFreezeRecords(ids: readonly string[]): Promise<void> {
  return write((store) => {
    for (const id of ids) store.delete(id);
  });
}

/** Every record left; their shape is the watchdog's, but they come from an earlier build's page. */
export async function readFreezeRecords(): Promise<readonly unknown[]> {
  const db = await open();
  try {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}
