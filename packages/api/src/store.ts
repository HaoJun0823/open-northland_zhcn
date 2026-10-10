import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CATALOG_FILE = 'catalog.json';
const RAW_DIR = 'raw';
const THUMBNAIL_DIR = 'thumbnails';
const RAW_PAGE = /^(\d+)\.json$/;
const THUMBNAIL_META_SUFFIX = '.json';

/** A stored thumbnail's bytes, with what was recorded when it was fetched. */
export interface StoredThumbnail {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/** What a thumbnail was fetched for: a changed `updatedAt` fetches it again. */
export interface ThumbnailMeta {
  readonly contentType: string;
  readonly updatedAt: string;
}

/** The data dir: `catalog.json` (the last good normalized catalogue), `raw/<page>.json` (the upstream
 *  pages it came from) and `thumbnails/<id>` beside `thumbnails/<id>.json` (bytes and their meta). */
export class DataStore {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.dir, RAW_DIR), { recursive: true });
    await mkdir(join(this.dir, THUMBNAIL_DIR), { recursive: true });
  }

  /** The stored catalogue text and when it was written, or null before the first good sync. */
  async readCatalog(): Promise<{ text: string; writtenAt: Date } | null> {
    const path = join(this.dir, CATALOG_FILE);
    try {
      const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      return { text, writtenAt: info.mtime };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  writeCatalog(text: string): Promise<void> {
    return writeAtomic(join(this.dir, CATALOG_FILE), text);
  }

  /** Replaces the raw pages with this download's, dropping pages past its last. */
  async writeRawPages(pages: readonly { readonly page: number; readonly body: unknown }[]): Promise<void> {
    const dir = join(this.dir, RAW_DIR);
    for (const { page, body } of pages) await writeAtomic(join(dir, `${page}.json`), JSON.stringify(body));
    const kept = new Set(pages.map(({ page }) => page));
    for (const name of await readdir(dir)) {
      const page = RAW_PAGE.exec(name)?.[1];
      if (page !== undefined && !kept.has(Number(page))) await rm(join(dir, name), { force: true });
    }
  }

  async readThumbnailMeta(id: string): Promise<ThumbnailMeta | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.thumbnailPath(id) + THUMBNAIL_META_SUFFIX, 'utf8'));
      if (typeof raw !== 'object' || raw === null) return null;
      const { contentType, updatedAt } = raw as Record<string, unknown>;
      return typeof contentType === 'string' && typeof updatedAt === 'string'
        ? { contentType, updatedAt }
        : null;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async readThumbnail(id: string): Promise<StoredThumbnail | null> {
    const meta = await this.readThumbnailMeta(id);
    if (meta === null) return null;
    try {
      return { bytes: await readFile(this.thumbnailPath(id)), contentType: meta.contentType };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** The bytes land before the meta, so a meta always describes complete bytes. */
  async writeThumbnail(id: string, bytes: Uint8Array, meta: ThumbnailMeta): Promise<void> {
    await writeAtomic(this.thumbnailPath(id), bytes);
    await writeAtomic(this.thumbnailPath(id) + THUMBNAIL_META_SUFFIX, JSON.stringify(meta));
  }

  /** Removes the thumbnails of maps no longer in the catalogue. */
  async pruneThumbnails(keep: ReadonlySet<string>): Promise<void> {
    const dir = join(this.dir, THUMBNAIL_DIR);
    for (const name of await readdir(dir)) {
      const id = name.endsWith(THUMBNAIL_META_SUFFIX) ? name.slice(0, -THUMBNAIL_META_SUFFIX.length) : name;
      if (!keep.has(id)) await rm(join(dir, name), { force: true });
    }
  }

  /** Callers pass only ids that passed `CATALOG_MAP_ID`, which admits no path separator. */
  private thumbnailPath(id: string): string {
    return join(this.dir, THUMBNAIL_DIR, id);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

let writeSequence = 0;

/** Writes beside the target and renames over it, so a reader sees the old file or the new one. */
async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  writeSequence += 1;
  const temporary = `${path}.${process.pid}.${writeSequence}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
