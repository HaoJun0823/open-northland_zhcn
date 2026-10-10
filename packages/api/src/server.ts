import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { CATALOG_MAP_ID } from '@open-northland/data';
import { MAP_FILE_SUFFIXES } from '@open-northland/map-import';
import type { Body, CatalogSnapshot } from './catalog/snapshot.js';
import { bytesBody, jsonBody } from './catalog/snapshot.js';
import type { Log } from './catalog/thumbnails.js';
import type { DataStore } from './store.js';

export const HEALTH_PATH = '/healthz';
const CATALOG_PATH = '/v1/catalog';
const MAP_PATH = /^\/v1\/maps\/([^/]+)(\/thumbnail)?$/;
const CONTENT_PATH = /^\/v1\/content\/([^/]+)\/maps\/([^/]+)$/;
/** The sidecars the content route serves, longest first so `.meta.json` wins over `.json`. The
 *  minimap is left out: the client renders previews itself. */
const CONTENT_SUFFIXES: readonly string[] = Object.entries(MAP_FILE_SUFFIXES)
  .filter(([kind]) => kind !== 'minimap')
  .map(([, suffix]) => suffix)
  .sort((a, b) => b.length - a.length);
const PNG_SUFFIX = '.png';
/** A sidecar changes only when its entry converts again, which also changes its `ETag`. */
const CONTENT_CACHE = 'public, max-age=3600';
const PNG_TYPE = 'image/png';
const GZIP = 'gzip';
/** The catalogue changes a few times a day at most. */
const CATALOG_CACHE = 'public, max-age=300';
/** The catalogue names a thumbnail by a URL carrying its bytes' hash, so a replaced one gets a new URL. */
const THUMBNAIL_CACHE = 'public, max-age=86400';
const MS_PER_SECOND = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 5000;
const JSON_TYPE = 'application/json; charset=utf-8';
const OK = 200;
const NO_CONTENT = 204;
const NOT_MODIFIED = 304;
/** How long a browser may reuse a `/v1` preflight answer. */
const PREFLIGHT_MAX_AGE_SECONDS = 86_400;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const INTERNAL_ERROR = 500;
const UNAVAILABLE = 503;

/** The health endpoint's body. */
export interface ApiHealth {
  readonly ok: boolean;
  readonly build: string | null;
  readonly lastSyncAt: string | null;
  readonly staleSeconds: number | null;
  readonly entryCount: number;
  /** Entries by conversion verdict in the served catalogue. */
  readonly converted: number;
  readonly pending: number;
  readonly failed: number;
}

/** One stored sidecar: its file, its precompressed copy when there is one, and its validator. */
export interface ContentFile {
  readonly path: string;
  readonly gzipPath: string | null;
  readonly etag: string;
}

/** The converted maps of one IR version, by map id and sidecar file name. */
export interface ContentSource {
  readonly irVersion: number;
  file(mapId: string, fileName: string): ContentFile | null;
}

export interface ApiServerOptions {
  /** 0 picks a free port; read it back from the server. */
  readonly port: number;
  readonly host?: string | null;
  readonly build?: string | null;
  readonly store: DataStore;
  /** Serves `/v1/content/<irVersion>/maps/*`; without it every content request is a 404. */
  readonly content?: ContentSource;
  readonly log?: Log;
  readonly now?: () => Date;
}

export interface ApiServer {
  readonly port: number;
  /** Replaces the served catalogue; a sync calls it after each good run. */
  publish(snapshot: CatalogSnapshot): void;
  health(): ApiHealth;
  close(): Promise<void>;
}

/** Every `/v1` endpoint is public and read-only, so every origin may read it and its validator. */
const V1_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'ETag',
} as const;

/** The request target up to its query, taken as text: nothing here needs more than the path. */
function pathOf(request: IncomingMessage): string {
  return (request.url ?? '/').split('?', 1)[0] ?? '/';
}

/** Whether `If-None-Match` names `etag`, as one of a list or as `*`. */
function holds(request: IncomingMessage, etag: string): boolean {
  const header = request.headers['if-none-match'];
  if (header === undefined) return false;
  return header.split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === '*' || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/** Whether `Accept-Encoding` admits gzip, by name or `*`, with a nonzero quality. */
function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers['accept-encoding'];
  if (header === undefined) return false;
  return header.split(',').some((part) => {
    const [coding = '', ...parameters] = part.split(';').map((piece) => piece.trim().toLowerCase());
    if (coding !== GZIP && coding !== '*') return false;
    const quality = parameters.find((parameter) => parameter.startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

/** The map id and suffix of a content file name, or null unless both are valid. */
function contentName(fileName: string): { mapId: string; suffix: string } | null {
  for (const suffix of CONTENT_SUFFIXES) {
    if (!fileName.endsWith(suffix)) continue;
    const mapId = fileName.slice(0, -suffix.length);
    return CATALOG_MAP_ID.test(mapId) ? { mapId, suffix } : null;
  }
  return null;
}

/** Answers with `body`, or 304 when the request already holds it. Only a 200 carries the validator. */
function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: Body,
  headers: Readonly<Record<string, string>>,
): void {
  const ok = status === OK;
  if (ok && holds(request, body.etag)) {
    response.writeHead(NOT_MODIFIED, { ...headers, etag: body.etag }).end();
    return;
  }
  response.writeHead(status, {
    'content-type': JSON_TYPE,
    ...headers,
    'content-length': body.bytes.length,
    ...(ok ? { etag: body.etag } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : body.bytes);
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  error: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(request, response, status, jsonBody({ error }), { 'cache-control': 'no-store', ...headers });
}

/** Serve the catalogue over plain HTTP. */
export function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const build = options.build ?? null;
  let snapshot: CatalogSnapshot | null = null;

  const health = (): ApiHealth => ({
    ok: snapshot !== null,
    build,
    lastSyncAt: snapshot?.syncedAt.toISOString() ?? null,
    staleSeconds:
      snapshot === null
        ? null
        : Math.max(0, Math.floor((now().getTime() - snapshot.syncedAt.getTime()) / MS_PER_SECOND)),
    entryCount: snapshot?.entries.size ?? 0,
    converted: snapshot?.conversions.converted ?? 0,
    pending: snapshot?.conversions.pending ?? 0,
    failed: snapshot?.conversions.failed ?? 0,
  });

  /** Streams one sidecar from disk, the gzip copy when the request takes it. */
  const serveContent = async (
    request: IncomingMessage,
    response: ServerResponse,
    version: string,
    fileName: string,
  ): Promise<void> => {
    const content = options.content;
    const served = content?.irVersion ?? null;
    if (served === null || version !== String(served)) {
      send(
        request,
        response,
        NOT_FOUND,
        jsonBody({ error: 'content version not served', irVersion: served }),
        {
          ...V1_HEADERS,
          'cache-control': 'no-store',
        },
      );
      return;
    }
    const name = contentName(fileName);
    const file = name === null ? null : (content?.file(name.mapId, fileName) ?? null);
    if (name === null || file === null) {
      sendError(request, response, NOT_FOUND, 'no such file', V1_HEADERS);
      return;
    }
    const headers: Record<string, string> = {
      ...V1_HEADERS,
      'cache-control': CONTENT_CACHE,
      'content-type': name.suffix === PNG_SUFFIX ? PNG_TYPE : JSON_TYPE,
      'x-content-type-options': 'nosniff',
      vary: 'Accept-Encoding',
      etag: file.etag,
    };
    if (holds(request, file.etag)) {
      response.writeHead(NOT_MODIFIED, headers).end();
      return;
    }
    const gzipped = file.gzipPath !== null && acceptsGzip(request);
    const path = gzipped && file.gzipPath !== null ? file.gzipPath : file.path;
    let size: number;
    try {
      ({ size } = await stat(path));
    } catch {
      // Replaced or pruned since the lookup.
      sendError(request, response, NOT_FOUND, 'no such file', V1_HEADERS);
      return;
    }
    response.writeHead(OK, {
      ...headers,
      ...(gzipped ? { 'content-encoding': GZIP } : {}),
      'content-length': size,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await pipeline(createReadStream(path), response);
  };

  const serveThumbnail = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> => {
    const stored = snapshot?.entries.has(id) ? await options.store.readThumbnail(id) : null;
    if (stored === null) {
      sendError(request, response, NOT_FOUND, 'no thumbnail', V1_HEADERS);
      return;
    }
    send(request, response, OK, bytesBody(stored.bytes), {
      ...V1_HEADERS,
      'cache-control': THUMBNAIL_CACHE,
      'content-type': stored.contentType,
      'x-content-type-options': 'nosniff',
    });
  };

  const serveV1 = async (request: IncomingMessage, response: ServerResponse, path: string): Promise<void> => {
    const content = CONTENT_PATH.exec(path);
    if (content?.[1] !== undefined && content[2] !== undefined) {
      await serveContent(request, response, content[1], content[2]);
      return;
    }
    if (snapshot === null) {
      sendError(request, response, UNAVAILABLE, 'catalogue not synced yet', V1_HEADERS);
      return;
    }
    const headers = { ...V1_HEADERS, 'cache-control': CATALOG_CACHE };
    if (path === CATALOG_PATH) {
      send(request, response, OK, snapshot.catalog, headers);
      return;
    }
    const match = MAP_PATH.exec(path);
    const id = match?.[1];
    if (id === undefined || !CATALOG_MAP_ID.test(id)) {
      sendError(request, response, NOT_FOUND, 'not found', V1_HEADERS);
      return;
    }
    if (match?.[2] !== undefined) {
      await serveThumbnail(request, response, id);
      return;
    }
    const entry = snapshot.entries.get(id);
    if (entry === undefined) sendError(request, response, NOT_FOUND, 'no such map', V1_HEADERS);
    else send(request, response, OK, entry, headers);
  };

  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = pathOf(request);
    const v1 = path.startsWith('/v1/');
    if (request.method === 'OPTIONS' && v1) {
      // A browser preflights a request whose `If-None-Match` it set itself.
      response
        .writeHead(NO_CONTENT, {
          ...V1_HEADERS,
          'access-control-allow-methods': 'GET, HEAD',
          'access-control-allow-headers': 'If-None-Match',
          'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
        })
        .end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(request, response, METHOD_NOT_ALLOWED, 'method not allowed', {
        allow: 'GET, HEAD',
        ...(v1 ? V1_HEADERS : {}),
      });
      return;
    }
    if (path === HEALTH_PATH) {
      const report = health();
      send(request, response, report.ok ? OK : UNAVAILABLE, jsonBody(report), {
        'cache-control': 'no-store',
      });
      return;
    }
    if (v1) {
      await serveV1(request, response, path);
      return;
    }
    sendError(request, response, NOT_FOUND, 'not found');
  };

  const server: Server = createServer(
    { headersTimeout: HEADERS_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
    (request, response) => {
      // A fault in one request costs that request, never the server.
      serve(request, response).catch((error: unknown) => {
        log('request failed', { error: String(error) });
        if (!response.headersSent) sendError(request, response, INTERNAL_ERROR, 'internal error');
        else response.end();
      });
    },
  );

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? undefined, () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      log('listening', { port, host: options.host ?? null, build });
      resolve({
        port,
        publish: (next) => {
          snapshot = next;
        },
        health,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
