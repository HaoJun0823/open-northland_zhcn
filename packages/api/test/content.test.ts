import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Catalog, CatalogEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyMapDocuments } from '../../app/src/content/transfer/documents.js';
import { type ApiServer, startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import {
  catalogEntry,
  FakeFiles,
  type Harness,
  harness,
  plaintextMap,
  syncedOf,
  under,
  zipOf,
} from './support/conversion-fixture.js';

const ENTRY = 'cn-wyspa';
const ARCHIVE = zipOf(under('Wyspa', plaintextMap('Wyspa')));
const MAP_ID = `${ENTRY}-wyspa`;
const CONTENT = `/v1/content/${IR_VERSION}/maps`;

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

describe('content route', () => {
  let dir: string;
  let server: ApiServer;
  let converted: Harness;

  /** A request with exactly these headers: `fetch` would add and undo its own gzip negotiation. */
  const raw = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<RawResponse>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path, method, headers },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-content-'));
    const files = new FakeFiles();
    files.serve(ENTRY, ARCHIVE);
    converted = await harness(dir, files, { irVersion: IR_VERSION });
    const store = new DataStore(dir);
    await store.init();
    server = await startApiServer({ port: 0, host: '127.0.0.1', store, content: converted.service });
    converted.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await converted.service.idle();
    const snapshot = converted.published.at(-1);
    if (snapshot === undefined) throw new Error('nothing published');
    server.publish(snapshot);
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves a terrain document with its hash, caching, CORS and type', async () => {
    const response = await raw(`${CONTENT}/${MAP_ID}.json`);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      vary: 'Accept-Encoding',
    });
    expect(response.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(response.body.toString('utf8'))).toHaveProperty('typeIds');
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await raw(`${CONTENT}/${MAP_ID}.meta.json`);
    const again = await raw(`${CONTENT}/${MAP_ID}.meta.json`, { 'if-none-match': first.headers.etag ?? '' });
    expect(again.status).toBe(304);
    expect(again.body.byteLength).toBe(0);
    expect(again.headers['access-control-allow-origin']).toBe('*');
  });

  it('sends the stored gzip file as-is to a request that takes gzip and inflates it for any other', async () => {
    const stored = await readFile(join(dir, 'converted', String(IR_VERSION), ENTRY, `${MAP_ID}.json.gz`));
    const gzipped = await raw(`${CONTENT}/${MAP_ID}.json`, { 'accept-encoding': 'br, gzip;q=0.8' });
    expect(gzipped.headers['content-encoding']).toBe('gzip');
    expect(Number(gzipped.headers['content-length'])).toBe(gzipped.body.byteLength);
    expect(gzipped.body).toEqual(stored);
    const plain = await raw(`${CONTENT}/${MAP_ID}.json`);
    expect(plain.body).toEqual(gunzipSync(stored));
    expect(plain.headers.etag).toBe(gzipped.headers.etag);
    const refused = await raw(`${CONTENT}/${MAP_ID}.json`, { 'accept-encoding': 'gzip;q=0' });
    expect(refused.headers['content-encoding']).toBeUndefined();
    expect(refused.body).toEqual(plain.body);
  });

  it('names the archive size and the cell grid of each map in the entry', async () => {
    const entry = CatalogEntry.parse(
      await (await fetch(`http://127.0.0.1:${server.port}/v1/maps/${ENTRY}`)).json(),
    );
    expect(entry.file).toEqual({ kind: 'archive', bytes: ARCHIVE.byteLength });
    if (entry.conversion?.verdict !== 'ok') throw new Error('not converted');
    const terrain = JSON.parse((await raw(`${CONTENT}/${MAP_ID}.json`)).body.toString('utf8'));
    expect(entry.conversion.maps[0]?.cells).toEqual({ width: terrain.width, height: terrain.height });
    const catalog = Catalog.parse(await (await fetch(`http://127.0.0.1:${server.port}/v1/catalog`)).json());
    expect(catalog[0]).toEqual(entry);
  });

  it('answers HEAD with the headers and no body', async () => {
    const head = await raw(`${CONTENT}/${MAP_ID}.script.json`, { 'accept-encoding': 'gzip' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    expect(head.body.byteLength).toBe(0);
    const inflated = await raw(`${CONTENT}/${MAP_ID}.script.json`, {}, 'HEAD');
    expect(inflated.status).toBe(200);
    expect(inflated.body.byteLength).toBe(0);
  });

  it('answers another IR version with the served one', async () => {
    const response = await raw(`/v1/content/${IR_VERSION + 1}/maps/${MAP_ID}.json`);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body.toString('utf8'))).toEqual({
      error: 'content version not served',
      irVersion: IR_VERSION,
    });
  });

  it('misses a bad suffix, an unknown or invalid id and a traversal attempt', async () => {
    for (const path of [
      `${CONTENT}/${MAP_ID}.map.png`,
      `${CONTENT}/${MAP_ID}.txt`,
      `${CONTENT}/${MAP_ID}.png`,
      `${CONTENT}/cn-nothing-here.json`,
      `${CONTENT}/${ENTRY}.json`,
      `${CONTENT}/conversion.json`,
      `${CONTENT}/..%2F..%2Fcatalog.json`,
      `${CONTENT}/../../catalog.json`,
      `${CONTENT}/${MAP_ID}`,
    ]) {
      expect((await raw(path)).status, path).toBe(404);
    }
  });

  it('reports the verdict counts on the health check', async () => {
    const response = await raw('/healthz');
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ converted: 1, pending: 0, failed: 0 });
  });

  it('publishes the fingerprint the app computes from the served documents', async () => {
    const map = JSON.parse((await raw(`${CONTENT}/${MAP_ID}.json`)).body.toString('utf8'));
    const script = JSON.parse((await raw(`${CONTENT}/${MAP_ID}.script.json`)).body.toString('utf8'));
    const entry = await (await fetch(`http://127.0.0.1:${server.port}/v1/maps/${ENTRY}`)).json();
    const conversion = converted.served(ENTRY).conversion;
    if (conversion?.verdict !== 'ok') throw new Error('not converted');
    const fingerprint = verifyMapDocuments(MAP_ID, map, script).fingerprint;
    expect(conversion.maps[0]?.fingerprint).toBe(fingerprint);
    expect(entry.conversion.maps[0].fingerprint).toBe(fingerprint);
  });
});
