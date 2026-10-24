import type { CatalogEntry } from '@open-northland/data';
import { errorMessage } from '../log.js';
import type { DataStore } from '../store.js';
import { readCappedBody } from '../upstream/body.js';
import { type Fetch, UPSTREAM_TIMEOUT_MS } from '../upstream/strapi.js';
import type { NormalizedRecord } from './normalize.js';

/** The image types served back; anything else from the upstream is refused rather than relayed. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** The upstream's small renditions weigh tens of kilobytes; this only refuses a runaway body. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** Parallel requests to the upstream while thumbnails are fetched. */
const FETCH_CONCURRENCY = 4;

export type Log = (event: string, fields?: Record<string, unknown>) => void;

/** The URL the catalogue hands out, versioned by the stored bytes' hash so a replaced screenshot
 *  gets a new URL; the route ignores the query. */
export function thumbnailPath(id: string, sha256: string): string {
  return `/v1/maps/${id}/thumbnail?v=${sha256}`;
}

async function fetchThumbnail(
  fetchFn: Fetch,
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetchFn(url, {
    redirect: 'error',
    signal:
      signal === undefined
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`answered ${response.status}`);
  }
  const contentType =
    (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    !IMAGE_TYPES.has(contentType) ||
    Number(response.headers.get('content-length') ?? 0) > MAX_THUMBNAIL_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(!IMAGE_TYPES.has(contentType) ? `content type ${contentType || 'missing'}` : 'too large');
  }
  const bytes = await readCappedBody(response, MAX_THUMBNAIL_BYTES);
  return { bytes, contentType };
}

/** The hash of the thumbnail `record` ends up with, or null for none: kept when fetched for the same
 *  `updatedAt`, fetched otherwise. A failed fetch keeps an older stored one. */
async function syncThumbnail(
  fetchFn: Fetch,
  store: DataStore,
  record: NormalizedRecord,
  log: Log,
  signal?: AbortSignal,
): Promise<string | null> {
  const { id, updatedAt } = record.entry;
  const meta = await store.readThumbnailMeta(id);
  if (record.screenshotUrl === null) return null;
  if (meta?.updatedAt === updatedAt) return meta.sha256;
  try {
    const { bytes, contentType } = await fetchThumbnail(fetchFn, record.screenshotUrl, signal);
    signal?.throwIfAborted();
    return (await store.writeThumbnail(id, bytes, { contentType, updatedAt })).sha256;
  } catch (error) {
    signal?.throwIfAborted();
    log('thumbnail failed', { id, error: errorMessage(error) });
    return meta?.sha256 ?? null;
  }
}

/** The catalogue entries, each naming its thumbnail when one is stored, after fetching the new and
 *  changed ones and dropping those of maps that left the catalogue. */
export async function syncThumbnails(
  fetchFn: Fetch,
  store: DataStore,
  records: readonly NormalizedRecord[],
  log: Log,
  signal?: AbortSignal,
): Promise<CatalogEntry[]> {
  const stored = new Array<string | null>(records.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < records.length) {
      signal?.throwIfAborted();
      const index = next++;
      const record = records[index];
      if (record !== undefined) stored[index] = await syncThumbnail(fetchFn, store, record, log, signal);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: FETCH_CONCURRENCY }, worker));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  signal?.throwIfAborted();
  await store.pruneThumbnails(
    new Set(records.filter((_, index) => stored[index] != null).map(({ entry }) => entry.id)),
  );
  return records.map(({ entry }, index) => {
    const sha256 = stored[index];
    return sha256 == null ? entry : { ...entry, thumbnail: thumbnailPath(entry.id, sha256) };
  });
}
