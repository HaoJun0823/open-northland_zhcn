import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { CATALOG_MAP_ID, CatalogConversion } from '@open-northland/data';
import { sha256Hex } from '../catalog/snapshot.js';
import { isMissing, writeAtomic } from '../store.js';

const ARCHIVE_DIR = 'archives';
const CONVERTED_DIR = 'converted';
const CONVERSION_FILE = 'conversion.json';
const SOURCE_FILE = 'source.json';
export const GZIP_SUFFIX = '.gz';
/** Sidecars ending so are text and get a precompressed copy. */
const TEXT_SUFFIX = '.json';
const TEMPORARY_SUFFIX = '.tmp';
const SHA256_HEX = /^[a-f0-9]{64}$/;
const gzipAsync = promisify(gzip);

/** A kept catalogue file: `archives/<id>/<sha256>.<ext>` and what it was downloaded for. */
export interface ArchiveSource {
  readonly sha256: string;
  readonly ext: string;
  readonly updatedAt: string;
  readonly url: string;
}

/** `converted/<irVersion>/<id>/conversion.json`: the verdict and what it was made from. */
export interface StoredConversion {
  readonly conversion: CatalogConversion;
  /** Null when the file was refused before it was downloaded. */
  readonly archiveSha256: string | null;
  /** The upstream `updatedAt` of the entry the archive was downloaded for. */
  readonly updatedAt: string;
  /** The SHA-256 of every sidecar by file name, the served `ETag`. */
  readonly files: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStored(value: unknown): StoredConversion | null {
  if (!isRecord(value)) return null;
  const { conversion, archiveSha256, updatedAt, files } = value;
  const parsed = CatalogConversion.safeParse(conversion);
  if (!parsed.success || parsed.data.verdict === 'pending') return null;
  if (archiveSha256 !== null && (typeof archiveSha256 !== 'string' || !SHA256_HEX.test(archiveSha256))) {
    return null;
  }
  if (typeof updatedAt !== 'string' || !isRecord(files)) return null;
  const hashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(files)) {
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) return null;
    hashes[name] = hash;
  }
  return { conversion: parsed.data, archiveSha256, updatedAt, files: hashes };
}

function parseSource(value: unknown): ArchiveSource | null {
  if (!isRecord(value)) return null;
  const { sha256, ext, updatedAt, url } = value;
  return typeof sha256 === 'string' &&
    SHA256_HEX.test(sha256) &&
    typeof ext === 'string' &&
    /^[a-z0-9]+$/.test(ext) &&
    typeof updatedAt === 'string' &&
    typeof url === 'string'
    ? { sha256, ext, updatedAt, url }
    : null;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Entry ids among a directory's names; anything else, temporaries included, is not ours to read. */
async function entryIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => CATALOG_MAP_ID.test(name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

let directorySequence = 0;

/**
 * The kept archives and the converted sidecars under the data dir. Every id passed in passed
 * `CATALOG_MAP_ID`, which admits no path separator, and every file name is `<mapId><suffix>` built
 * from such an id and a fixed suffix.
 */
export class ConversionStore {
  readonly convertedDir: string;
  private readonly archiveDir: string;

  constructor(
    readonly dir: string,
    readonly irVersion: number,
  ) {
    this.archiveDir = join(dir, ARCHIVE_DIR);
    this.convertedDir = join(dir, CONVERTED_DIR, String(irVersion));
  }

  /** Creates the directories and deletes every other IR version's output and any unfinished write.
   *  Returns the removed version directories. */
  async init(): Promise<string[]> {
    await mkdir(this.archiveDir, { recursive: true });
    await mkdir(this.convertedDir, { recursive: true });
    const removed: string[] = [];
    const versionsDir = join(this.dir, CONVERTED_DIR);
    for (const name of await readdir(versionsDir)) {
      if (name === String(this.irVersion)) continue;
      await rm(join(versionsDir, name), { recursive: true, force: true });
      removed.push(name);
    }
    for (const name of await readdir(this.convertedDir)) {
      if (name.endsWith(TEMPORARY_SUFFIX))
        await rm(join(this.convertedDir, name), { recursive: true, force: true });
    }
    return removed;
  }

  /** Every stored verdict of this IR version; an unreadable one is left out and converts again. */
  async readConversions(): Promise<Map<string, StoredConversion>> {
    const stored = new Map<string, StoredConversion>();
    for (const id of await entryIds(this.convertedDir)) {
      const conversion = parseStored(await readJson(join(this.convertedDir, id, CONVERSION_FILE)));
      if (conversion !== null) stored.set(id, conversion);
    }
    return stored;
  }

  async readSources(): Promise<Map<string, ArchiveSource>> {
    const sources = new Map<string, ArchiveSource>();
    for (const id of await entryIds(this.archiveDir)) {
      const source = parseSource(await readJson(join(this.archiveDir, id, SOURCE_FILE)));
      if (source !== null) sources.set(id, source);
    }
    return sources;
  }

  /** The kept archive's bytes, or null when the file is gone or no longer matches its hash. */
  async readArchive(id: string, source: ArchiveSource): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(join(this.archiveDir, id, `${source.sha256}.${source.ext}`));
      return sha256Hex(bytes) === source.sha256 ? bytes : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** Keeps `bytes` as the entry's only archive. The bytes land before the source that names them. */
  async keepArchive(id: string, bytes: Uint8Array, source: ArchiveSource): Promise<void> {
    const dir = join(this.archiveDir, id);
    await mkdir(dir, { recursive: true });
    const name = `${source.sha256}.${source.ext}`;
    await writeAtomic(join(dir, name), bytes);
    await writeAtomic(join(dir, SOURCE_FILE), JSON.stringify(source));
    for (const other of await readdir(dir)) {
      if (other !== name && other !== SOURCE_FILE) await rm(join(dir, other), { force: true });
    }
  }

  /** Replaces the entry's directory with `files`, a gzip copy of each text file and the verdict, all
   *  written into a temporary directory first so a reader never sees half a conversion. Returns the
   *  sidecar hashes it recorded. */
  async writeConversion(
    id: string,
    verdict: Omit<StoredConversion, 'files'>,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<StoredConversion> {
    directorySequence += 1;
    const temporary = join(this.convertedDir, `${id}.${process.pid}.${directorySequence}${TEMPORARY_SUFFIX}`);
    const target = join(this.convertedDir, id);
    try {
      await mkdir(temporary);
      const hashes: Record<string, string> = {};
      for (const [name, bytes] of files) {
        hashes[name] = sha256Hex(bytes);
        await writeFile(join(temporary, name), bytes);
        if (name.endsWith(TEXT_SUFFIX))
          await writeFile(join(temporary, name + GZIP_SUFFIX), await gzipAsync(bytes));
      }
      const stored: StoredConversion = { ...verdict, files: hashes };
      await writeFile(join(temporary, CONVERSION_FILE), JSON.stringify(stored));
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
      return stored;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  sidecarPath(id: string, fileName: string): string {
    return join(this.convertedDir, id, fileName);
  }

  /** Whether `fileName` got a precompressed copy. */
  hasGzip(fileName: string): boolean {
    return fileName.endsWith(TEXT_SUFFIX);
  }

  /** Removes the archives and conversions of entries no longer in the catalogue. */
  async prune(keep: ReadonlySet<string>): Promise<string[]> {
    const removed = new Set<string>();
    for (const root of [this.archiveDir, this.convertedDir]) {
      for (const id of await entryIds(root)) {
        if (keep.has(id)) continue;
        await rm(join(root, id), { recursive: true, force: true });
        removed.add(id);
      }
    }
    return [...removed];
  }
}
