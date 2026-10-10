import type { CatalogEntry } from '@open-northland/data';
import type { DataStore } from '../store.js';
import { type Fetch, UPSTREAM_TIMEOUT_MS } from '../upstream/strapi.js';
import type { NormalizedRecord } from './normalize.js';

/** The image types served back; anything else from the upstream is refused rather than relayed. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** The upstream's small renditions weigh tens of kilobytes; this only refuses a runaway body. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** Parallel requests to the upstream while thumbnails are fetched. */
const FETCH_CONCURRENCY = 4;

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export function thumbnailPath(id: string): string {
  return `/v1/maps/${id}/thumbnail`;
}

async function fetchThumbnail(
  fetchFn: Fetch,
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const contentType =
    (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!IMAGE_TYPES.has(contentType)) throw new Error(`content type ${contentType || 'missing'}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_THUMBNAIL_BYTES) throw new Error('too large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) throw new Error(`${bytes.byteLength} bytes`);
  return { bytes, contentType };
}

/** Whether `record` ends up with a stored thumbnail: kept when fetched for the same `updatedAt`,
 *  fetched otherwise. A failed fetch keeps an older stored one. */
async function syncThumbnail(
  fetchFn: Fetch,
  store: DataStore,
  record: NormalizedRecord,
  log: Log,
): Promise<boolean> {
  const { id, updatedAt } = record.entry;
  const meta = await store.readThumbnailMeta(id);
  if (record.screenshotUrl === null) return false;
  if (meta?.updatedAt === updatedAt) return true;
  try {
    const { bytes, contentType } = await fetchThumbnail(fetchFn, record.screenshotUrl);
    await store.writeThumbnail(id, bytes, { contentType, updatedAt });
    return true;
  } catch (error) {
    log('thumbnail failed', { id, error: error instanceof Error ? error.message : String(error) });
    return meta !== null;
  }
}

/** The catalogue entries, each naming its thumbnail when one is stored, after fetching the new and
 *  changed ones and dropping those of maps that left the catalogue. */
export async function syncThumbnails(
  fetchFn: Fetch,
  store: DataStore,
  records: readonly NormalizedRecord[],
  log: Log,
): Promise<CatalogEntry[]> {
  const stored = new Array<boolean>(records.length).fill(false);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < records.length) {
      const index = next++;
      const record = records[index];
      if (record !== undefined) stored[index] = await syncThumbnail(fetchFn, store, record, log);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  await store.pruneThumbnails(
    new Set(records.filter((_, index) => stored[index]).map(({ entry }) => entry.id)),
  );
  return records.map(({ entry }, index) =>
    stored[index] ? { ...entry, thumbnail: thumbnailPath(entry.id) } : entry,
  );
}
