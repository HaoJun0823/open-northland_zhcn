import { open } from 'node:fs/promises';
import type { CatalogConversion, CatalogEntry } from '@open-northland/data';
import { DEFAULT_IMPORT_LIMITS, detectArchiveFormat, MapImportError } from '@open-northland/map-import';
import { type CatalogSnapshot, catalogSnapshot, sha256Hex } from '../catalog/snapshot.js';
import type { SyncedCatalog } from '../catalog/sync.js';
import type { Log } from '../catalog/thumbnails.js';
import type { ContentFile, ContentSource, KeptFile, KeptFileSource } from '../http/sources.js';
import { isMissing } from '../store.js';
import type { Fetch } from '../upstream/strapi.js';
import { DownloadError, type DownloadLimits, downloadArchive } from './download.js';
import { type CatalogMapOverlays, overlayFingerprints, overlaysUnchanged } from './overlays.js';
import type {
  ArchiveSource,
  ConversionStore,
  ConversionVerdict,
  KeptArchive,
  StoredConversion,
} from './store.js';
import type { ArchiveConverter } from './worker-converter.js';

/** A hang guard: the largest catalogue file is tens of megabytes. */
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** The extension a kept file gets when its leading bytes name no supported format. */
const UNKNOWN_EXT = 'bin';
const MICROSECONDS_PER_MS = 1000;

/** The catalogue links the kept file by a URL carrying its hash, so a replaced file gets a new URL. */
function keptFilePath(id: string, sha256: string): string {
  return `/v1/maps/${id}/file?v=${sha256}`;
}

/** The last segment of the upstream URL's path, percent-decoded; empty when it names none. */
function upstreamFileName(url: string): string {
  if (!URL.canParse(url)) return '';
  const segment = new URL(url).pathname.split('/').at(-1) ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export const DEFAULT_DOWNLOAD_LIMITS: DownloadLimits = {
  maxBytes: DEFAULT_IMPORT_LIMITS.archiveBytes,
  timeoutMs: DOWNLOAD_TIMEOUT_MS,
};

export interface ConversionServiceOptions {
  readonly store: ConversionStore;
  readonly fetch: Fetch;
  readonly converter: ArchiveConverter;
  /** The overlays the converter applies, against which stored conversions are judged current. */
  readonly mapOverlays: CatalogMapOverlays;
  readonly concurrency: number;
  /** Receives the catalogue with every entry's `conversion`, after each catalogue and each batch. */
  readonly publish: (snapshot: CatalogSnapshot) => void;
  readonly log?: Log;
  readonly downloadLimits?: DownloadLimits;
}

/** Where one converted map's sidecars live, with their hashes by file name. */
interface MapLocation {
  readonly entryId: string;
  readonly generation: string;
  readonly files: ReadonlyMap<string, string>;
}

type Attempt =
  | {
      readonly kind: 'converted';
      readonly verdict: ConversionVerdict;
      readonly files: ReadonlyMap<string, Uint8Array>;
    }
  | { readonly kind: 'download-failed'; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Downloads and converts the catalogue's files in a queue, keeps the verdicts and serves the sidecars
 * of this build's IR version. An entry converts again when its `updatedAt`, its kept archive or the
 * translation overlays of one of its maps change, and a stored failure once more per process. A
 * failed download is retried with the next catalogue and keeps an older good conversion serving.
 */
export class ConversionService implements ContentSource, KeptFileSource {
  readonly irVersion: number;
  private readonly log: Log;
  private readonly downloadLimits: DownloadLimits;
  private catalog: SyncedCatalog | null = null;
  private entries: ReadonlyMap<string, CatalogEntry> = new Map();
  private stored = new Map<string, StoredConversion>();
  private sources = new Map<string, KeptArchive>();
  /** Download failures since the entry's last stored verdict, by entry id. */
  private readonly downloadFailures = new Map<string, string>();
  private readonly maps = new Map<string, MapLocation>();
  private readonly mapIdsByEntry = new Map<string, readonly string[]>();
  private readonly queue: string[] = [];
  /** Queued or running. */
  private readonly waiting = new Set<string>();
  /** Stored failures this process has already tried again. */
  private readonly retriedFailures = new Set<string>();
  private batch: Promise<void> | null = null;
  private prunePending = false;
  private stopped = false;
  private readonly abort = new AbortController();

  constructor(private readonly options: ConversionServiceOptions) {
    this.irVersion = options.store.irVersion;
    this.log = options.log ?? (() => undefined);
    this.downloadLimits = options.downloadLimits ?? DEFAULT_DOWNLOAD_LIMITS;
  }

  /** Drops other IR versions and loads the stored verdicts and kept archives. */
  async init(): Promise<void> {
    const removed = await this.options.store.init();
    if (removed.length > 0) this.log('converted versions removed', { versions: removed });
    this.stored = await this.options.store.readConversions();
    this.sources = await this.options.store.readSources();
    for (const [id, stored] of this.stored) this.index(id, stored);
  }

  /** Takes a new catalogue: publishes it at once, then queues every entry whose file needs converting. */
  setCatalog(synced: SyncedCatalog): void {
    if (this.stopped) return;
    this.catalog = synced;
    this.entries = new Map(synced.catalog.map((entry) => [entry.id, entry]));
    this.prunePending = true;
    for (const entry of synced.catalog) if (this.needsWork(entry)) this.enqueue(entry.id);
    this.publish();
    this.kick();
  }

  /** Resolves once the queue is empty and no conversion runs. */
  async idle(): Promise<void> {
    while (this.batch !== null) await this.batch;
  }

  /** Cancels downloads and worker jobs, then waits for outstanding storage operations. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.waiting.clear();
    this.abort.abort();
    await this.options.converter.stop();
    await this.idle();
  }

  async file(mapId: string, fileName: string): Promise<ContentFile | null> {
    for (;;) {
      const location = this.maps.get(mapId);
      const hash = location?.files.get(fileName);
      if (location === undefined || hash === undefined || !this.entries.has(location.entryId)) return null;
      try {
        const handle = await open(
          this.options.store.sidecarPath(location.entryId, location.generation, fileName),
        );
        return { handle, gzipped: this.options.store.isGzipped(fileName), etag: `"${hash}"` };
      } catch (error) {
        if (!isMissing(error)) throw error;
        // A replacement can retire this generation while open is in flight. Resolve the new one.
        if (this.maps.get(mapId) === location) return null;
      }
    }
  }

  async keptFile(id: string, signal?: AbortSignal): Promise<KeptFile | null> {
    const entry = this.entry(id);
    const kept = entry === undefined ? null : this.keptArchive(entry);
    if (kept === null) return null;
    const handle = await this.options.store.openVerifiedArchive(id, kept, signal);
    if (handle === null) return null;
    const name = upstreamFileName(kept.url);
    return { handle, sha256: kept.sha256, name: name === '' ? `${id}.${kept.ext}` : name };
  }

  private entry(id: string): CatalogEntry | undefined {
    return this.entries.get(id);
  }

  private needsWork(entry: CatalogEntry): boolean {
    if (entry.file.kind === 'external' || this.waiting.has(entry.id)) return false;
    const stored = this.stored.get(entry.id);
    if (stored === undefined || stored.updatedAt !== entry.updatedAt) return true;
    // A stored failure gets one more try per process: a newer build may unpack what the last could not.
    if (stored.conversion.verdict === 'failed' && !this.retriedFailures.has(entry.id)) {
      this.retriedFailures.add(entry.id);
      return true;
    }
    if (!overlaysUnchanged(this.options.mapOverlays, stored.overlays)) return true;
    const source = this.sources.get(entry.id);
    return source !== undefined && stored.archiveSha256 !== null && source.sha256 !== stored.archiveSha256;
  }

  private enqueue(id: string): void {
    this.queue.push(id);
    this.waiting.add(id);
  }

  private conversionOf(entry: CatalogEntry): CatalogConversion | undefined {
    if (this.waiting.has(entry.id)) return { verdict: 'pending' };
    const stored = this.stored.get(entry.id)?.conversion;
    const failure = this.downloadFailures.get(entry.id);
    if (failure !== undefined && stored?.verdict !== 'ok') {
      return { verdict: 'failed', reason: 'download-failed', message: failure };
    }
    return stored;
  }

  private publish(): CatalogSnapshot | null {
    if (this.catalog === null) return null;
    const entries = this.catalog.catalog.map((entry) => {
      if (entry.file.kind === 'external') return entry;
      const conversion = this.conversionOf(entry);
      const kept = this.keptArchive(entry);
      const file = kept === null ? {} : { bytes: kept.bytes, path: keptFilePath(entry.id, kept.sha256) };
      return {
        ...entry,
        file: { ...entry.file, ...file },
        ...(conversion === undefined ? {} : { conversion }),
      };
    });
    const snapshot = catalogSnapshot(entries, this.catalog.syncedAt);
    this.options.publish(snapshot);
    return snapshot;
  }

  /** The kept archive when it was downloaded for the entry's current `updatedAt` and is on disk. A
   *  failed conversion keeps it too, so a player can unpack it by hand. */
  private keptArchive(entry: CatalogEntry): (KeptArchive & { readonly bytes: number }) | null {
    const kept = this.sources.get(entry.id);
    if (kept?.updatedAt !== entry.updatedAt || kept.bytes === null) return null;
    return { ...kept, bytes: kept.bytes };
  }

  private kick(): void {
    if (this.batch !== null || this.stopped || (this.queue.length === 0 && !this.prunePending)) return;
    this.batch = this.runBatch().finally(() => {
      this.batch = null;
      this.kick();
    });
  }

  private async runBatch(): Promise<void> {
    const startedAt = performance.now();
    const cpuBefore = process.cpuUsage();
    let entries = 0;
    const worker = async (): Promise<void> => {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        const convertedFor = await this.convertEntry(id);
        this.waiting.delete(id);
        entries += 1;
        // The catalogue may have moved on while this entry converted.
        const current = this.entry(id);
        if (
          !this.stopped &&
          current !== undefined &&
          current.updatedAt !== convertedFor &&
          this.needsWork(current)
        ) {
          this.enqueue(id);
        }
      }
    };
    await Promise.all(Array.from({ length: this.options.concurrency }, worker));
    if (!this.stopped) {
      this.prunePending = false;
      await this.prune();
    }
    const snapshot = this.publish();
    const cpu = process.cpuUsage(cpuBefore);
    this.log('conversion batch done', {
      entries,
      ms: Math.round(performance.now() - startedAt),
      cpuMs: Math.round((cpu.user + cpu.system) / MICROSECONDS_PER_MS),
      rssBytes: process.memoryUsage.rss(),
      ...snapshot?.conversions,
    });
  }

  /** The `updatedAt` it converted for, or null when the entry left. Never throws: every failure
   *  becomes a verdict or a log line. */
  private async convertEntry(id: string): Promise<string | null> {
    const entry = this.entry(id);
    if (entry === undefined || entry.file.kind === 'external') return null;
    const startedAt = performance.now();
    const attempt = await this.attempt(entry);
    if (this.stopped) return entry.updatedAt;
    if (attempt.kind === 'download-failed') {
      this.downloadFailures.set(id, attempt.message);
      this.log('download failed', { id, error: attempt.message });
    } else {
      if (
        attempt.verdict.conversion.verdict === 'failed' &&
        this.stored.get(id)?.conversion.verdict === 'ok'
      ) {
        this.log('replacement conversion failed', { id, error: attempt.verdict.conversion.message });
        return entry.updatedAt;
      }
      try {
        const stored = await this.options.store.writeConversion(id, attempt.verdict, attempt.files);
        this.stored.set(id, stored);
        this.downloadFailures.delete(id);
        this.index(id, stored);
        await this.options.store.pruneGenerations(id, stored.generation).catch((error: unknown) => {
          this.log('old conversion cleanup failed', { id, error: messageOf(error) });
        });
        const { conversion } = stored;
        this.log('conversion done', {
          id,
          verdict: conversion.verdict,
          ...(conversion.verdict === 'ok' ? { maps: conversion.maps.length } : {}),
          ...(conversion.verdict === 'failed'
            ? { reason: conversion.reason, error: conversion.message }
            : {}),
          ms: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        this.log('conversion not stored', { id, error: messageOf(error) });
      }
    }
    return entry.updatedAt;
  }

  private async attempt(entry: CatalogEntry): Promise<Attempt> {
    const { id, updatedAt } = entry;
    let archiveSha256: string | null = null;
    try {
      const archive = await this.archiveFor(entry);
      archiveSha256 = archive.sha256;
      const result = await this.options.converter.convert(archive.bytes, id, (message) =>
        this.log('conversion warning', { id, message }),
      );
      return {
        kind: 'converted',
        verdict: {
          conversion: { verdict: 'ok', irVersion: this.irVersion, maps: [...result.maps] },
          archiveSha256,
          updatedAt,
          overlays: overlayFingerprints(this.options.mapOverlays, result.datDigests),
        },
        files: result.files,
      };
    } catch (error) {
      if (error instanceof DownloadError) return { kind: 'download-failed', message: error.message };
      const reason = error instanceof MapImportError ? error.kind : 'decode-failed';
      return {
        kind: 'converted',
        verdict: {
          conversion: { verdict: 'failed', reason, message: messageOf(error) },
          archiveSha256,
          updatedAt,
          overlays: {},
        },
        files: new Map(),
      };
    }
  }

  /** The kept archive when it was downloaded for this `updatedAt`, else a fresh download, kept. */
  private async archiveFor(entry: CatalogEntry): Promise<{ bytes: Uint8Array; sha256: string }> {
    const kept = this.sources.get(entry.id);
    if (kept?.updatedAt === entry.updatedAt) {
      const bytes = await this.options.store.readArchive(entry.id, kept);
      if (bytes !== null) return { bytes, sha256: kept.sha256 };
    }
    const url = this.catalog?.downloads.get(entry.id);
    if (url === undefined) throw new DownloadError('no download URL for this entry');
    const bytes = await downloadArchive(this.options.fetch, url, this.downloadLimits, this.abort.signal);
    const source: ArchiveSource = {
      sha256: sha256Hex(bytes),
      ext: detectArchiveFormat(bytes) ?? UNKNOWN_EXT,
      updatedAt: entry.updatedAt,
      url,
    };
    await this.options.store.keepArchive(entry.id, bytes, source);
    this.sources.set(entry.id, { ...source, bytes: bytes.byteLength });
    return { bytes, sha256: source.sha256 };
  }

  private index(id: string, stored: StoredConversion | undefined): void {
    for (const mapId of this.mapIdsByEntry.get(id) ?? []) this.maps.delete(mapId);
    this.mapIdsByEntry.delete(id);
    if (stored?.conversion.verdict !== 'ok') return;
    const mapIds = stored.conversion.maps.map(({ mapId }) => mapId);
    for (const mapId of mapIds) {
      const files = new Map(
        Object.entries(stored.files).filter(
          ([name]) => name.startsWith(mapId) && name.charAt(mapId.length) === '.',
        ),
      );
      this.maps.set(mapId, { entryId: id, generation: stored.generation, files });
    }
    this.mapIdsByEntry.set(id, mapIds);
  }

  private async prune(): Promise<void> {
    if (this.catalog === null) return;
    try {
      const removed = await this.options.store.prune(new Set(this.catalog.catalog.map(({ id }) => id)));
      for (const id of removed) {
        this.stored.delete(id);
        this.sources.delete(id);
        this.downloadFailures.delete(id);
        this.index(id, undefined);
        // A sync can restore an entry while its old files are being removed.
        const current = this.entry(id);
        if (!this.stopped && current !== undefined && this.needsWork(current)) this.enqueue(id);
      }
      if (removed.length > 0) this.log('conversions pruned', { ids: removed });
    } catch (error) {
      this.log('prune failed', { error: messageOf(error) });
    }
  }
}
