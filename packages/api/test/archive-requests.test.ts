import { type FileHandle, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogSnapshot, sha256Hex } from '../src/catalog/snapshot.js';
import { ArchiveVerificationBusyError, ArchiveVerifier } from '../src/conversion/archive-verifier.js';
import type { KeptFileSource } from '../src/http/sources.js';
import { type ApiServer, startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import { catalogEntry } from './support/conversion-fixture.js';

const ENTRY = 'cn-verification';
const PATH = `/v1/maps/${ENTRY}/file`;

describe('archive request admission and cancellation', () => {
  let dir: string;
  let server: ApiServer | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-archive-http-'));
  });
  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const start = async (files: KeptFileSource) => {
    server = await startApiServer({ port: 0, host: '127.0.0.1', store: new DataStore(dir), files });
    server.publish(catalogSnapshot([catalogEntry(ENTRY)], new Date()));
    return `http://127.0.0.1:${server.port}${PATH}`;
  };

  it('reads the archive only once for concurrent and repeated HEAD/conditional requests', async () => {
    const path = join(dir, 'archive');
    const bytes = Buffer.alloc(8 * 1024 * 1024, 3);
    const hash = sha256Hex(bytes);
    await writeFile(path, bytes);
    const probe = await open(path);
    const prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, 'createReadStream'>;
    const original = prototype.createReadStream;
    await probe.close();
    let passes = 0;
    let bytesRead = 0;
    vi.spyOn(prototype, 'createReadStream').mockImplementation(function (this: FileHandle, options) {
      passes += 1;
      const stream = original.call(this, options);
      stream.on('data', (chunk: Buffer) => {
        bytesRead += chunk.length;
      });
      return stream;
    });
    const verifier = new ArchiveVerifier();
    const url = await start({
      keptFile: async (_id, signal) => {
        const handle = await verifier.open(path, hash, signal);
        return handle === null ? null : { handle, sha256: hash, name: 'map.zip' };
      },
    });
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fetch(url, index % 2 === 0 ? { method: 'HEAD' } : { headers: { 'if-none-match': `"${hash}"` } }),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([
      200, 304, 200, 304, 200, 304, 200, 304, 200, 304, 200, 304,
    ]);
    for (const response of responses) expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(url, { method: 'HEAD' })).status).toBe(200);
    expect({ passes, bytesRead }).toEqual({ passes: 1, bytesRead: bytes.length });
  });

  it('answers overload with a retryable CORS response', async () => {
    const url = await start({
      keptFile: async () => {
        throw new ArchiveVerificationBusyError();
      },
    });
    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('aborts verification when the HTTP client disconnects', async () => {
    let began: () => void = () => undefined;
    let cancelled: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const url = await start({
      keptFile: async (_id, signal) => {
        began();
        await new Promise<void>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              cancelled();
              resolve();
            },
            { once: true },
          );
        });
        return null;
      },
    });
    const client = request(url);
    client.on('error', () => undefined);
    client.end();
    await started;
    client.destroy();
    await aborted;
  });
});
