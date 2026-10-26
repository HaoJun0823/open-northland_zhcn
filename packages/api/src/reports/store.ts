import { randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing, writeAtomic } from '../store.js';
import type { DecodedUpload } from './decode.js';
import { readableJson, type StoredFile } from './files.js';

const TMP_DIR = '.tmp';
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
/** `<HHMMSS>Z-<trigger>-<id>`; every part is server-chosen or schema-checked. */
const ENTRY_DIR = /^\d{6}Z-[a-z-]+-([0-9a-f]{32})$/;
const REPORT_FILE = 'report.json';
const ADDENDUM_FILE = 'addendum.json';
const SUPPRESSED_FILE = 'suppressed.json';
const ISO_DATE_LENGTH = 10;
/** Error codes of a volume out of space or quota: the store is full whatever its counters say. */
const DISK_FULL: ReadonlySet<string> = new Set(['ENOSPC', 'EDQUOT']);

export interface ReportStoreLimits {
  readonly maxStoredBytes: number;
  readonly maxStoredReports: number;
  readonly fingerprintPerDay: number;
}

/** `suppressed`: the fingerprint passed its daily cap, or its sender already has one stored today,
 *  so the report was only counted. `missing`:
 *  an addendum's report is not stored (any more). */
export type StoreOutcome = 'stored' | 'duplicate' | 'suppressed' | 'full' | 'missing';

/** Public through the health endpoint, so it tells only whether reports are refused. */
export interface ReportStoreHealth {
  readonly full: boolean;
}

/**
 * Report files on disk as `<date>/<HHMMSS>Z-<trigger>-<id>/`. An entry is written in a temporary
 * directory and renamed into place, so a reader never sees half of one. The owner deletes entries by
 * hand at any time, so the counters and the id index are rebuilt by `rescan`, and a missing entry
 * only means the id is new again. Writes run one at a time.
 */
export class ReportStore {
  private index = new Map<string, string>();
  private count = 0;
  private bytes = 0;
  /** The senders of each fingerprint's reports stored today, at most the daily cap per fingerprint;
   *  kept in memory, so a restart starts the day over. */
  private fingerprints = { day: '', senders: new Map<string, Set<string>>() };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly limits: ReportStoreLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    await rm(join(this.dir, TMP_DIR), { recursive: true, force: true });
    await mkdir(join(this.dir, TMP_DIR), { recursive: true });
    await this.rescan();
  }

  health(): ReportStoreHealth {
    // Full when not even one more byte fits.
    return { full: this.full(1) };
  }

  /** Recounts entries and bytes and rebuilds the id index from what is on disk now. */
  rescan(): Promise<void> {
    return this.serial(async () => {
      const index = new Map<string, string>();
      let count = 0;
      let bytes = 0;
      for (const day of await entriesOf(this.dir)) {
        if (!day.isDirectory() || !DATE_DIR.test(day.name)) continue;
        for (const entry of await entriesOf(join(this.dir, day.name))) {
          const path = join(day.name, entry.name);
          if (entry.isFile()) bytes += await sizeOf(join(this.dir, path));
          const id = entry.isDirectory() ? ENTRY_DIR.exec(entry.name)?.[1] : undefined;
          if (id === undefined) continue;
          count += 1;
          for (const file of await entriesOf(join(this.dir, path))) {
            if (file.isFile()) bytes += await sizeOf(join(this.dir, path, file.name));
          }
          index.set(id, path);
        }
      }
      this.index = index;
      this.count = count;
      this.bytes = bytes;
    });
  }

  /** Whether `id` names a stored report, which may take its one addendum or a retry of it. */
  async holdsReport(id: string): Promise<boolean> {
    const path = this.index.get(id);
    return path !== undefined && (await exists(join(this.dir, path, REPORT_FILE)));
  }

  /** `sender` is the limiter's key for the client: each sender counts once toward a fingerprint's
   *  daily cap, so one client cannot use it up for everyone. */
  save(upload: DecodedUpload, sender: string): Promise<StoreOutcome> {
    return this.serial(() =>
      upload.part === 'report' ? this.saveReport(upload, sender) : this.saveAddendum(upload),
    );
  }

  /** Waits for the write in progress. */
  async close(): Promise<void> {
    await this.serial(async () => undefined);
  }

  private async saveReport(
    report: Extract<DecodedUpload, { part: 'report' }>,
    sender: string,
  ): Promise<StoreOutcome> {
    const known = this.index.get(report.id);
    if (known !== undefined && (await exists(join(this.dir, known, REPORT_FILE)))) return 'duplicate';
    const at = this.now();
    const fingerprint = report.fingerprint;
    const senders = fingerprint === undefined ? null : this.sendersToday(fingerprint, at);
    if (
      fingerprint !== undefined &&
      senders !== null &&
      (senders.has(sender) || senders.size >= this.limits.fingerprintPerDay)
    ) {
      await this.countSuppressed(fingerprint, at);
      return 'suppressed';
    }
    if (this.full(bytesOf(report.files))) return 'full';
    try {
      this.index.set(report.id, await this.writeEntry(at, report.trigger, report.id, report.files));
    } catch (error) {
      if (DISK_FULL.has(errorCode(error) ?? '')) return 'full';
      throw error;
    }
    senders?.add(sender);
    return 'stored';
  }

  /** Adds the addendum to its report's entry; the report may have been deleted since it was asked. */
  private async saveAddendum(addendum: Extract<DecodedUpload, { part: 'addendum' }>): Promise<StoreOutcome> {
    const path = this.index.get(addendum.id);
    if (path === undefined || !(await exists(join(this.dir, path, REPORT_FILE)))) return 'missing';
    if (await exists(join(this.dir, path, ADDENDUM_FILE))) return 'duplicate';
    const note = readableJson({
      comment: addendum.comment,
      contact: addendum.contact,
      receivedAt: this.now().toISOString(),
    });
    // The note goes last: once it is there, the addendum is complete. A retry after a failure
    // links only the files still missing.
    const files: StoredFile[] = [...addendum.files, [ADDENDUM_FILE, note]];
    if (this.full(bytesOf(files))) return 'full';
    try {
      await this.addToEntry(path, files);
    } catch (error) {
      if (DISK_FULL.has(errorCode(error) ?? '')) return 'full';
      if (isMissing(error)) return 'missing';
      throw error;
    }
    return 'stored';
  }

  /** Writes a new entry directory and returns its path relative to the store. */
  private async writeEntry(
    at: Date,
    trigger: string,
    id: string,
    files: readonly StoredFile[],
  ): Promise<string> {
    const day = at.toISOString().slice(0, ISO_DATE_LENGTH);
    const path = join(day, `${timeOfDay(at)}Z-${trigger}-${id}`);
    const temporary = join(this.dir, TMP_DIR, randomUUID());
    try {
      await mkdir(temporary);
      for (const [name, bytes] of files) await writeFile(join(temporary, name), bytes);
      await mkdir(join(this.dir, day), { recursive: true });
      await rename(temporary, join(this.dir, path));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    this.count += 1;
    this.bytes += bytesOf(files);
    return path;
  }

  /** Links each file into an existing entry; a name the entry already holds keeps its file. */
  private async addToEntry(path: string, files: readonly StoredFile[]): Promise<void> {
    const temporary = join(this.dir, TMP_DIR, randomUUID());
    try {
      await mkdir(temporary);
      for (const [name, bytes] of files) {
        await writeFile(join(temporary, name), bytes);
        try {
          await link(join(temporary, name), join(this.dir, path, name));
          this.bytes += bytes.length;
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
        }
        await unlink(join(temporary, name));
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private sendersToday(fingerprint: string, at: Date): Set<string> {
    const day = at.toISOString().slice(0, ISO_DATE_LENGTH);
    if (this.fingerprints.day !== day) this.fingerprints = { day, senders: new Map() };
    let senders = this.fingerprints.senders.get(fingerprint);
    if (senders === undefined) {
      senders = new Set();
      this.fingerprints.senders.set(fingerprint, senders);
    }
    return senders;
  }

  /** Adds one to the fingerprint's count in `<date>/suppressed.json`, keeping counts already there. */
  private async countSuppressed(fingerprint: string, at: Date): Promise<void> {
    const day = at.toISOString().slice(0, ISO_DATE_LENGTH);
    const path = join(this.dir, day, SUPPRESSED_FILE);
    let counts: Record<string, number> = {};
    let before = 0;
    try {
      const text = await readFile(path, 'utf8');
      before = Buffer.byteLength(text);
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        counts = Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, number] => Number.isInteger(entry[1])),
        );
      }
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
    }
    counts[fingerprint] = (counts[fingerprint] ?? 0) + 1;
    const bytes = readableJson(counts);
    await mkdir(join(this.dir, day), { recursive: true });
    await writeAtomic(path, bytes);
    this.bytes += bytes.length - before;
  }

  /** Whether the report count is at its cap or writing `incoming` more bytes would pass the byte cap. */
  private full(incoming: number): boolean {
    return this.count >= this.limits.maxStoredReports || this.bytes + incoming > this.limits.maxStoredBytes;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function bytesOf(files: readonly StoredFile[]): number {
  return files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

function timeOfDay(at: Date): string {
  return [at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
}

/** A directory's entries; none when the owner removed it meanwhile. */
async function entriesOf(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
