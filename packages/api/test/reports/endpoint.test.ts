import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportEndpoint } from '../../src/reports/endpoint.js';
import { ReportLimiter } from '../../src/reports/limiter.js';
import { ReportStore } from '../../src/reports/store.js';
import { type ApiServer, startApiServer } from '../../src/server.js';
import { DataStore } from '../../src/store.js';
import { addendum, REPORT_ID, report, wire } from '../support/report-fixture.js';

const KIB = 1024;
const GAME = 'https://game.opennorthland.org';
const LIMITS = {
  maxReportBytes: 64 * KIB,
  maxAddendumBytes: 128 * KIB,
  maxInflatedBytes: 256 * KIB,
  ipReportsPerHour: 100,
  ipReportsPerDay: 100,
  ipAddendaPerHour: 100,
  uploadsPerHour: 100,
  uploadBytesPerHour: 1 << 30,
  fingerprintPerDay: 100,
  maxStoredBytes: 1 << 30,
  maxStoredReports: 100,
};
const idOf = (n: number): string => n.toString(16).padStart(32, '0');

describe('POST /v1/reports', () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  const start = async (limits: Partial<typeof LIMITS> = {}, trustForwardedFor = false) => {
    const dir = await mkdtemp(join(tmpdir(), 'on-api-report-endpoint-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const config = { origins: [GAME], trustForwardedFor, limits: { ...LIMITS, ...limits } };
    const store = new ReportStore(join(dir, 'reports'), config.limits);
    await store.init();
    const reports = new ReportEndpoint({ config, store, limiter: new ReportLimiter(config.limits) });
    const server: ApiServer = await startApiServer({
      port: 0,
      host: '127.0.0.1',
      store: new DataStore(dir),
      reports,
    });
    cleanup.push(() => server.close());
    const url = `http://127.0.0.1:${server.port}/v1/reports`;
    const post = (body: Uint8Array<ArrayBuffer> | string, headers: Record<string, string> = {}) =>
      fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain', ...headers } });
    return { url, post, server };
  };

  it('stores a gzipped report from an allowed origin and answers its preflight', async () => {
    const { url, post, server } = await start();
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: GAME } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');

    const sent = await post(wire(report()), { origin: GAME });
    expect(sent.status).toBe(204);
    expect(sent.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(sent.headers.get('vary')).toBe('Origin');
    expect((await post(wire(report()), { origin: 'http://127.0.0.1:5173' })).status).toBe(204);
    expect(server.health().reports).toMatchObject({ count: 1, full: false });
    expect((await fetch(url)).status).toBe(405);
  });

  it('refuses foreign origins, other types, oversize and invalid bodies with fixed messages', async () => {
    const { url, post } = await start();
    const evil = { origin: 'https://evil.example' };
    expect((await fetch(url, { method: 'OPTIONS', headers: evil })).status).toBe(403);
    expect((await post(wire(report()), evil)).status).toBe(403);
    expect((await post(wire(report()), { 'content-type': 'application/json' })).status).toBe(415);
    expect((await post(JSON.stringify(report()))).status).toBe(415);
    const invalid = await post(wire({ ...report(), trigger: '<script>' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid report' });
    const bomb = await post(wire({ ...report(), comment: 'x'.repeat(LIMITS.maxInflatedBytes) }));
    expect(bomb.status).toBe(413);

    // Refused from the header alone: the server answers before any of the body arrives.
    const declared = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'content-length': String(LIMITS.maxReportBytes + 1) },
      });
      request.on('response', (response) => {
        resolve(response.statusCode);
        request.destroy();
      });
      request.on('error', reject);
      request.flushHeaders();
    });
    expect(declared).toBe(413);
  });

  it("takes one addendum at its report's path and answers 404 for any other id before the body", async () => {
    const { url, post } = await start();
    const toReport = (body: Uint8Array<ArrayBuffer>) =>
      fetch(`${url}/${REPORT_ID}`, { method: 'POST', body, headers: { 'content-type': 'text/plain' } });
    expect((await toReport(wire(addendum()))).status).toBe(404);
    expect((await post(wire(report()))).status).toBe(204);
    expect((await post(wire(addendum()))).status).toBe(400);
    expect((await toReport(wire(addendum({ id: 'b2'.repeat(16) })))).status).toBe(400);
    // Incompressible: past the report cap, within the addendum's.
    const settings = { pad: randomBytes(80 * KIB).toString('base64') };
    expect((await post(wire(report({ attachments: { settings } })))).status).toBe(413);
    expect((await toReport(wire(addendum({ comment: 'ok', attachments: { settings } })))).status).toBe(204);
    expect((await toReport(wire(addendum()))).status).toBe(404);
    expect((await fetch(`${url}/${REPORT_ID.toUpperCase()}`, { method: 'POST' })).status).toBe(405);
  });

  it('limits each client, read from X-Forwarded-For only when trusted, and answers 429 with a wait', async () => {
    const trusted = await start({ ipReportsPerHour: 1 }, true);
    const from = (ip: string, id: string) => trusted.post(wire(report({ id })), { 'x-forwarded-for': ip });
    expect((await from('203.0.113.1', idOf(1))).status).toBe(204);
    const limited = await from('203.0.113.1', idOf(2));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await from('203.0.113.2', idOf(3))).status).toBe(204);

    const direct = await start({ ipReportsPerHour: 1 });
    const fromProxy = (ip: string, id: string) =>
      direct.post(wire(report({ id })), { 'x-forwarded-for': ip });
    expect((await fromProxy('203.0.113.1', idOf(1))).status).toBe(204);
    expect((await fromProxy('203.0.113.2', idOf(2))).status).toBe(429);
  });

  it('answers 507 while the store is full and still accepts a retry it holds', async () => {
    const { post } = await start({ maxStoredReports: 1 });
    expect((await post(wire(report({ id: idOf(1) })))).status).toBe(204);
    expect((await post(wire(report({ id: idOf(2) })))).status).toBe(507);
    expect((await post(wire(report({ id: idOf(1) })))).status).toBe(204);
  });
});
