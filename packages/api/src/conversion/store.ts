import { createHash, randomUUID } from 'node:crypto';
import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
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
const GZIP_SUFFIX = '.gz';
/** Sidecars ending so are text and are stored gzip-compressed only. */
const TEXT_SUFFIX = '.json';
const TEMPORARY_SUFFIX = '.tmp';
const SHA256_HEX = /^[a-f0-9]{64}$/;
const GENERATION = /^[a-f0-9-]{36}$/;
const CONVERSION_STORE_VERSION = 1;
const gzipAsync = promisify(gzip);

/** A kept catalogue file: `archives/<id>/<sha256>.<ext>` and what it was downloaded for. */
export interface ArchiveSource {
  readonly sha256: string;
  readonly ext: string;
  readonly updatedAt: string;
  readonly url: string;
}

/** A kept archive's source with the file's size in bytes, null when the file is gone. */
export interface KeptArchive extends ArchiveSource {
  readonly bytes: number | null;
}

/** `converted/<irVersion>/<id>/conversion.json`: the verdict and what it was made from. */
export interface StoredConversion {
  readonly version: typeof CONVERSION_STORE_VERSION;
  readonly generation: string;
  readonly conversion: CatalogConversion;
  /** Null when the file was refused before it was downloaded. */
  readonly archiveSha256: string | null;
  /** The upstream `updatedAt` of the entry the archive was downloaded for. */
  readonly updatedAt: string;
  /** The SHA-256 of every sidecar by file name, the served `ETag`. */
  readonly files: Readonly<Record<string, string>>;
}

export type ConversionVerdict = Omit<StoredConversion, 'version' | 'generation' | 'files'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStored(value: unknown): StoredConversion | null {
  if (!isRecord(value)) return null;
  const { version, generation, conversion, archiveSha256, updatedAt, files } = value;
  if (version !== CONVERSION_STORE_VERSION || typeof generation !== 'string' || !GENERATION.test(generation))
    return null;
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
  return { version, generation, conversion: parsed.data, archiveSha256, updatedAt, files: hashes };
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
      if (conversion !== null) {
        stored.set(id, conversion);
        await this.pruneGenerations(id, conversion.generation);
      }
    }
    return stored;
  }

  async readSources(): Promise<Map<string, KeptArchive>> {
    const sources = new Map<string, KeptArchive>();
    for (const id of await entryIds(this.archiveDir)) {
      const source = parseSource(await readJson(join(this.archiveDir, id, SOURCE_FILE)));
      if (source !== null) sources.set(id, { ...source, bytes: await this.archiveSize(id, source) });
    }
    return sources;
  }

  private async archiveSize(id: string, source: ArchiveSource): Promise<number | null> {
    try {
      return (await stat(join(this.archiveDir, id, `${source.sha256}.${source.ext}`))).size;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** The kept archive's bytes, or null when the file is gone or no longer matches its hash. */
  async readArchive(id: string, source: ArchiveSource): Promise<Buffer | null> {
    try {
      const bytes = await readFile(join(this.archiveDir, id, `${source.sha256}.${source.ext}`));
      return sha256Hex(bytes) === source.sha256 ? bytes : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** Verifies with bounded reads and keeps that inode open for the response. The caller closes the
   *  handle and starts its response stream at offset zero after this verification pass. */
  async openVerifiedArchive(id: string, source: ArchiveSource): Promise<FileHandle | null> {
    let handle: FileHandle;
    try {
      handle = await open(join(this.archiveDir, id, `${source.sha256}.${source.ext}`));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      const hash = createHash('sha256');
      for await (const bytes of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(bytes);
      if (hash.digest('hex') === source.sha256) return handle;
      await handle.close();
      return null;
    } catch (error) {
      await handle.close();
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

  /** Writes immutable sidecars, then atomically replaces the manifest that selects their generation.
   *  A failed write leaves the previous manifest and its files intact. */
  async writeConversion(
    id: string,
    verdict: ConversionVerdict,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<StoredConversion> {
    const generation = randomUUID();
    const entry = join(this.convertedDir, id);
    const temporary = join(entry, generation + TEMPORARY_SUFFIX);
    const target = join(entry, generation);
    try {
      await mkdir(entry, { recursive: true });
      await mkdir(temporary);
      const hashes: Record<string, string> = {};
      for (const [name, bytes] of files) {
        hashes[name] = sha256Hex(bytes);
        if (this.isGzipped(name))
          await writeFile(join(temporary, name + GZIP_SUFFIX), await gzipAsync(bytes));
        else await writeFile(join(temporary, name), bytes);
      }
      const stored: StoredConversion = {
        version: CONVERSION_STORE_VERSION,
        generation,
        ...verdict,
        files: hashes,
      };
      await rename(temporary, target);
      await writeAtomic(join(entry, CONVERSION_FILE), JSON.stringify(stored));
      return stored;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  }

  /** The stored file of a sidecar: `<fileName>.gz` when `isGzipped`, else `<fileName>`. */
  sidecarPath(id: string, generation: string, fileName: string): string {
    return join(
      this.convertedDir,
      id,
      generation,
      this.isGzipped(fileName) ? fileName + GZIP_SUFFIX : fileName,
    );
  }

  /** Call after publishing the new index; readers already holding a file handle retain its bytes. */
  async pruneGenerations(id: string, generation: string): Promise<void> {
    const entry = join(this.convertedDir, id);
    for (const name of await readdir(entry)) {
      if (name !== CONVERSION_FILE && name !== generation)
        await rm(join(entry, name), { recursive: true, force: true });
    }
  }

  isGzipped(fileName: string): boolean {
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
