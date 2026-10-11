import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { catalogMapId } from '../catalog/normalize.js';
import type { Log } from '../catalog/thumbnails.js';

const PAGES_PATH = '/api/downloads';
const PAGE_PARAMETER = 'pagination[page]';
const RAW_DIR = 'raw';
const ARCHIVE_DIR = 'archives';
const THUMBNAIL_DIR = 'thumbnails';
const SOURCE_FILE = 'source.json';
const META_SUFFIX = '.json';
const RAW_PAGE = /^(\d+)\.json$/;
const UPSTREAM_DOMAIN = 'culturesnation.pl';
const ARCHIVE_TYPE = 'application/octet-stream';
const JSON_TYPE = 'application/json; charset=utf-8';
const OK = 200;
const NOT_FOUND = 404;

/** A file the mock serves by request path. */
interface CachedFile {
  readonly path: string;
  readonly contentType: string;
}

export interface UpstreamMockOptions {
  /** The download cache: `raw/<page>.json`, `archives/<entryId>/` and `thumbnails/<entryId>`. */
  readonly cacheDir: string;
  /** 0 picks a free port; read it back from the result. */
  readonly port: number;
  readonly host: string;
  readonly log?: Log;
}

export interface UpstreamMock {
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isUpstreamHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === UPSTREAM_DOMAIN || host.endsWith(`.${UPSTREAM_DOMAIN}`);
}

/** The path and query a URL is served under here; relative URLs resolve against the upstream. */
function servedPath(url: string): string | null {
  try {
    const parsed = new URL(url, `https://${UPSTREAM_DOMAIN}`);
    return parsed.pathname + parsed.search;
  } catch {
    return null;
  }
}

/** `url` moved to `origin` when it points at the upstream, else unchanged. */
function rehome(url: unknown, origin: string): unknown {
  if (typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    return isUpstreamHost(parsed.hostname) ? `${origin}${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

/** The screenshot's original upload and each rendition, as the objects that carry their `url`. */
function screenshotImages(record: JsonRecord): JsonRecord[] {
  const shot = record.screenshot;
  if (!isRecord(shot)) return [];
  const formats = isRecord(shot.formats) ? Object.values(shot.formats) : [];
  return [shot, ...formats].filter(isRecord);
}

function rehomeRecord(record: unknown, origin: string): unknown {
  if (!isRecord(record)) return record;
  const copy = structuredClone(record);
  copy.fileUrl = rehome(copy.fileUrl, origin);
  for (const image of screenshotImages(copy)) image.url = rehome(image.url, origin);
  return copy;
}

async function readPages(cacheDir: string): Promise<JsonRecord[]> {
  const dir = join(cacheDir, RAW_DIR);
  const numbers = (await readdir(dir))
    .map((name) => RAW_PAGE.exec(name)?.[1])
    .filter((page) => page !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const pages: JsonRecord[] = [];
  for (const page of numbers) {
    const body = await readJson(join(dir, `${page}.json`));
    if (!isRecord(body) || !Array.isArray(body.data)) throw new Error(`raw page ${page} has no data`);
    pages.push(body);
  }
  return pages;
}

/** Each kept archive by the path of the upstream URL it was downloaded from. */
async function indexArchives(cacheDir: string): Promise<Map<string, CachedFile>> {
  const dir = join(cacheDir, ARCHIVE_DIR);
  const files = new Map<string, CachedFile>();
  for (const id of await readdir(dir)) {
    const source = await readJson(join(dir, id, SOURCE_FILE)).catch(() => null);
    if (!isRecord(source) || typeof source.url !== 'string') continue;
    const { sha256, ext } = source;
    const path = servedPath(source.url);
    if (path === null || typeof sha256 !== 'string' || typeof ext !== 'string') continue;
    files.set(path, { path: join(dir, id, `${sha256}.${ext}`), contentType: ARCHIVE_TYPE });
  }
  return files;
}

/** Each kept thumbnail under every screenshot path its record names. */
async function indexThumbnails(
  cacheDir: string,
  pages: readonly JsonRecord[],
): Promise<Map<string, CachedFile>> {
  const dir = join(cacheDir, THUMBNAIL_DIR);
  const files = new Map<string, CachedFile>();
  for (const record of pages.flatMap((page) => (Array.isArray(page.data) ? page.data : []))) {
    if (!isRecord(record) || typeof record.documentId !== 'string') continue;
    const id = catalogMapId(record.documentId);
    if (id === null) continue;
    const meta = await readJson(join(dir, id + META_SUFFIX)).catch(() => null);
    if (!isRecord(meta) || typeof meta.contentType !== 'string') continue;
    for (const { url } of screenshotImages(record)) {
      const path = typeof url === 'string' ? servedPath(url) : null;
      if (path !== null) files.set(path, { path: join(dir, id), contentType: meta.contentType });
    }
  }
  return files;
}

/** The raw page `page`, or an empty one past the last, as Strapi answers. */
function pageBody(pages: readonly JsonRecord[], page: number, origin: string): JsonRecord {
  const found = pages[page - 1];
  if (found !== undefined && Array.isArray(found.data)) {
    return { ...found, data: found.data.map((record) => rehomeRecord(record, origin)) };
  }
  const meta = pages[0]?.meta;
  const pagination = isRecord(meta) && isRecord(meta.pagination) ? meta.pagination : {};
  return { data: [], meta: { pagination: { ...pagination, page } } };
}

/**
 * Answers what `upstream/strapi.ts`, the thumbnail sync and the archive download ask the upstream,
 * from a local download of it, so the API runs without contacting culturesnation.pl.
 */
export async function startUpstreamMock(options: UpstreamMockOptions): Promise<UpstreamMock> {
  const log = options.log ?? (() => undefined);
  const pages = await readPages(options.cacheDir);
  const files = new Map([
    ...(await indexArchives(options.cacheDir)),
    ...(await indexThumbnails(options.cacheDir, pages)),
  ]);
  let origin = '';

  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<number> => {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === PAGES_PATH) {
      const page = Number(url.searchParams.get(PAGE_PARAMETER) ?? '1');
      const body = Buffer.from(JSON.stringify(pageBody(pages, page, origin)));
      response.writeHead(OK, { 'content-type': JSON_TYPE, 'content-length': body.length }).end(body);
      return OK;
    }
    const file = files.get(url.pathname + url.search);
    const size =
      file === undefined
        ? null
        : await stat(file.path).then(
            ({ size: bytes }) => bytes,
            () => null,
          );
    if (file === undefined || size === null) {
      response.writeHead(NOT_FOUND, { 'content-type': JSON_TYPE }).end('{"error":"not found"}');
      return NOT_FOUND;
    }
    response.writeHead(OK, { 'content-type': file.contentType, 'content-length': size });
    await pipeline(createReadStream(file.path), response);
    return OK;
  };

  const server = createServer((request, response) => {
    serve(request, response).then(
      (status) => log('request', { method: request.method, path: request.url, status }),
      (error: unknown) => {
        log('request failed', { path: request.url, error: String(error) });
        if (!response.headersSent) response.writeHead(NOT_FOUND).end();
        else response.end();
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      origin = `http://${options.host}:${port}`;
      log('listening', { origin, pages: pages.length, files: files.size });
      resolve({
        port,
        origin,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
