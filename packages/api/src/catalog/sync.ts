import type { Catalog } from '@open-northland/data';
import type { DataStore } from '../store.js';
import { type Fetch, fetchCatalogPages } from '../upstream/strapi.js';
import { type NormalizedRecord, normalizeRecords } from './normalize.js';
import { type Log, syncThumbnails } from './thumbnails.js';

export interface SyncOptions {
  readonly fetch: Fetch;
  readonly upstream: string;
  readonly store: DataStore;
  readonly log: Log;
  readonly signal?: AbortSignal;
}

/** A catalogue as one sync left it, with the download URL of every entry that has a file to convert. */
export interface SyncedCatalog {
  readonly catalog: Catalog;
  readonly downloads: ReadonlyMap<string, string>;
  readonly syncedAt: Date;
}

/** Entry id to download URL, for the records whose file sits on the catalogue host. */
export function downloadsOf(records: readonly NormalizedRecord[]): Map<string, string> {
  const downloads = new Map<string, string>();
  for (const { entry, fileUrl } of records) if (fileUrl !== null) downloads.set(entry.id, fileUrl);
  return downloads;
}

async function storedEntryCount(store: DataStore): Promise<number> {
  const stored = await store.readCatalog();
  if (stored === null) return 0;
  const parsed: unknown = JSON.parse(stored.text);
  return Array.isArray(parsed) ? parsed.length : 0;
}

/** One sync: download every page, normalize, keep the raw pages, refresh thumbnails and replace
 *  `catalog.json`. Throws before touching the data dir when the upstream fails or lists no map while a
 *  non-empty catalogue is stored, so the last good catalogue stays. */
export async function syncCatalog(
  options: SyncOptions,
  now: () => Date = () => new Date(),
): Promise<SyncedCatalog> {
  const { fetch, upstream, store, log, signal } = options;
  const pages = await fetchCatalogPages(fetch, upstream, signal);
  const { records, skipped } = normalizeRecords(
    pages.flatMap(({ records: pageRecords }) => pageRecords),
    upstream,
  );
  for (const { upstreamId, reason } of skipped) log('record skipped', { upstreamId, reason });
  if (records.length === 0 && (await storedEntryCount(store)) > 0) {
    throw new Error('upstream lists no map; the stored catalogue stays');
  }
  signal?.throwIfAborted();
  await store.writeRawPages(pages);
  const catalog: Catalog = await syncThumbnails(fetch, store, records, log, signal);
  signal?.throwIfAborted();
  await store.writeCatalog(JSON.stringify(catalog));
  return { catalog, downloads: downloadsOf(records), syncedAt: now() };
}

/** Runs `syncCatalog` at start and then `intervalMs` after each run ends, handing each good result to
 *  `publish`. A failed run is logged and the previous catalogue keeps serving. */
export class CatalogSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly options: SyncOptions,
    private readonly intervalMs: number,
    private readonly publish: (synced: SyncedCatalog) => void,
  ) {}

  start(): void {
    this.running = this.run();
  }

  /** Cancels upstream work and waits for in-flight storage; no further sync starts. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private async run(): Promise<void> {
    const startedAt = performance.now();
    try {
      const signal =
        this.options.signal === undefined
          ? this.abort.signal
          : AbortSignal.any([this.abort.signal, this.options.signal]);
      const synced = await syncCatalog({ ...this.options, signal });
      if (!this.stopped) this.publish(synced);
      this.options.log('sync done', {
        entries: synced.catalog.length,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (!this.stopped)
        this.options.log('sync failed', { error: error instanceof Error ? error.message : String(error) });
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => {
        this.running = this.run();
      }, this.intervalMs);
      this.timer.unref();
    }
  }
}
