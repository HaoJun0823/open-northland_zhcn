import type { Catalog } from '@open-northland/data';
import type { DataStore } from '../store.js';
import { type Fetch, fetchCatalogPages } from '../upstream/strapi.js';
import { normalizeRecords } from './normalize.js';
import { type CatalogSnapshot, catalogSnapshot } from './snapshot.js';
import { type Log, syncThumbnails } from './thumbnails.js';

export interface SyncOptions {
  readonly fetch: Fetch;
  readonly upstream: string;
  readonly store: DataStore;
  readonly log: Log;
}

/** One sync: download every page, keep the raw pages, normalize, refresh thumbnails and replace
 *  `catalog.json`. Throws before touching `catalog.json` when the upstream fails, so the last good
 *  catalogue stays. */
export async function syncCatalog(
  options: SyncOptions,
  now: () => Date = () => new Date(),
): Promise<CatalogSnapshot> {
  const { fetch, upstream, store, log } = options;
  const pages = await fetchCatalogPages(fetch, upstream);
  await store.writeRawPages(pages);
  const { records, skipped } = normalizeRecords(
    pages.flatMap(({ records: pageRecords }) => pageRecords),
    upstream,
  );
  for (const { upstreamId, reason } of skipped) log('record skipped', { upstreamId, reason });
  const entries: Catalog = await syncThumbnails(fetch, store, records, log);
  const text = JSON.stringify(entries);
  const snapshot = catalogSnapshot(text, now());
  await store.writeCatalog(text);
  return snapshot;
}

/** Runs `syncCatalog` at start and then `intervalMs` after each run ends, handing each good result to
 *  `publish`. A failed run is logged and the previous catalogue keeps serving. */
export class CatalogSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly options: SyncOptions,
    private readonly intervalMs: number,
    private readonly publish: (snapshot: CatalogSnapshot) => void,
  ) {}

  start(): void {
    this.running = this.run();
  }

  /** Resolves once a sync in flight has finished; no further sync starts. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private async run(): Promise<void> {
    const startedAt = performance.now();
    try {
      const snapshot = await syncCatalog(this.options);
      this.publish(snapshot);
      this.options.log('sync done', {
        entries: snapshot.entries.size,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
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
