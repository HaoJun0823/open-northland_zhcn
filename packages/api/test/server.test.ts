import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog, CatalogEntry } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncCatalog } from '../src/catalog/sync.js';
import { type ApiServer, startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import { ACCEPTED_RECORDS, FakeUpstream, PNG_BYTES, UPSTREAM } from './support/strapi-fixture.js';

const SYNCED_AT = new Date('2024-05-01T00:00:00.000Z');
const LATER_SECONDS = 90;
const LATER = new Date(SYNCED_AT.getTime() + LATER_SECONDS * 1000);

describe('api server', () => {
  let dir: string;
  let store: DataStore;
  let server: ApiServer;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-server-'));
    store = new DataStore(dir);
    await store.init();
    server = await startApiServer({
      port: 0,
      host: '127.0.0.1',
      build: 'test-build',
      store,
      now: () => LATER,
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const sync = async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    server.publish(
      await syncCatalog(
        { fetch: upstream.fetch, upstream: UPSTREAM, store, log: () => undefined },
        () => SYNCED_AT,
      ),
    );
  };

  it('fails the health check until the first sync, then reports it', async () => {
    const before = await fetch(`${base}/healthz`);
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({
      ok: false,
      build: 'test-build',
      lastSyncAt: null,
      staleSeconds: null,
      entryCount: 0,
    });
    expect((await fetch(`${base}/v1/catalog`)).status).toBe(503);
    await sync();
    const after = await fetch(`${base}/healthz`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      ok: true,
      build: 'test-build',
      lastSyncAt: SYNCED_AT.toISOString(),
      staleSeconds: LATER_SECONDS,
      entryCount: ACCEPTED_RECORDS.length,
    });
  });

  it('serves a catalogue and entries that parse with the shared schema, with CORS and caching', async () => {
    await sync();
    const response = await fetch(`${base}/v1/catalog`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')).toBe('ETag');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const catalog = Catalog.parse(await response.json());
    expect(catalog).toHaveLength(ACCEPTED_RECORDS.length);
    const first = catalog[0];
    if (first === undefined) throw new Error('empty catalogue');
    const one = await fetch(`${base}/v1/maps/${first.id}`);
    expect(one.headers.get('access-control-allow-origin')).toBe('*');
    expect(CatalogEntry.parse(await one.json())).toEqual(first);
  });

  it('answers 304 to a matching If-None-Match and keeps the ETag across a resync', async () => {
    await sync();
    const first = await fetch(`${base}/v1/catalog`);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const cached = await fetch(`${base}/v1/catalog`, { headers: { 'if-none-match': etag ?? '' } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('access-control-allow-origin')).toBe('*');
    await sync();
    expect((await fetch(`${base}/v1/catalog`)).headers.get('etag')).toBe(etag);
  });

  it('serves stored thumbnails with their type and 404 for maps without one', async () => {
    await sync();
    const catalog = Catalog.parse(await (await fetch(`${base}/v1/catalog`)).json());
    const withShot = catalog.find((entry) => entry.thumbnail !== undefined);
    const withoutShot = catalog.find((entry) => entry.thumbnail === undefined);
    const image = await fetch(`${base}${withShot?.thumbnail}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG_BYTES);
    const missing = await fetch(`${base}/v1/maps/${withoutShot?.id}/thumbnail`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no thumbnail' });
  });

  it('allows GET and HEAD only and answers misses as JSON errors', async () => {
    await sync();
    const post = await fetch(`${base}/v1/catalog`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect(post.headers.get('access-control-allow-origin')).toBe('*');
    expect(await post.json()).toEqual({ error: 'method not allowed' });
    const head = await fetch(`${base}/v1/catalog`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const unknown = await fetch(`${base}/v1/maps/cn-nothing`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'no such map' });
    expect((await fetch(`${base}/v1/maps/..%2Fcatalog.json/thumbnail`)).status).toBe(404);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });

  it('answers a raw path traversal attempt with a miss', async () => {
    await sync();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path: '/v1/maps/../catalog.json/thumbnail' },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(404);
  });
});
