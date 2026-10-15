import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ArchiveConverter, WorkerArchiveConverter } from '../src/conversion/worker-converter.js';
import { type ApiServer, startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import {
  catalogEntry,
  FakeFiles,
  harness,
  plaintextMap,
  syncedOf,
  temporaryDir,
  under,
  zipOf,
} from './support/conversion-fixture.js';

const WORKER = new URL('../dist/conversion/worker.js', import.meta.url);
const SYNTHETIC_WORKER = new URL('./support/conversion-worker.mjs', import.meta.url);
const LATER = '2025-01-01T00:00:00.000Z';
const mapArchive = (): Uint8Array => zipOf(under('Island', plaintextMap('Island')));
const TIMEOUT_MS = 2000;
const BLOCKED_WORKER_STARTED = 'synthetic worker started';

/** Fires the fake conversion timer as soon as the synthetic worker reports that it is blocked. */
const expiringOnBlock = (instance: WorkerArchiveConverter): ArchiveConverter => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return {
    convert: (bytes, entryId, onWarning) =>
      instance.convert(bytes, entryId, (message) => {
        onWarning(message);
        if (message === BLOCKED_WORKER_STARTED) vi.advanceTimersByTime(TIMEOUT_MS);
      }),
    stop: () => instance.stop(),
  };
};

describe('worker archive conversion', () => {
  const converters: WorkerArchiveConverter[] = [];
  const directories: string[] = [];
  let api: ApiServer | undefined;
  const converter = (timeoutMs = 5000, worker = SYNTHETIC_WORKER): WorkerArchiveConverter => {
    const instance = new WorkerArchiveConverter(timeoutMs, worker);
    converters.push(instance);
    return instance;
  };
  const directory = async (): Promise<string> => {
    const dir = await temporaryDir();
    directories.push(dir);
    return dir;
  };
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(converters.map((item) => item.stop()));
    await api?.close();
    api = undefined;
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
    converters.length = 0;
    directories.length = 0;
  });

  it('uses the production worker for real archive conversion and retains typed decoder failures', async () => {
    const instance = converter(5000, WORKER);
    const bytes = mapArchive();
    const before = bytes.slice();
    const result = await instance.convert(bytes, 'cn-island', () => undefined);
    expect(result.maps[0]?.mapId).toBe('cn-island-island');
    expect(result.files.has('cn-island-island.json')).toBe(true);
    expect(bytes).toEqual(before);
    await expect(
      instance.convert(new Uint8Array([1, 2, 3]), 'cn-invalid', () => undefined),
    ).rejects.toMatchObject({ name: 'MapImportError', kind: 'unsupported-archive' });
  });

  it('keeps HTTP responsive during a blocked conversion and terminates jobs on shutdown', async () => {
    const instance = converter();
    const store = new DataStore(await directory());
    await store.init();
    api = await startApiServer({ store, host: '127.0.0.1', port: 0 });
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settled = false;
    const job = instance.convert(new Uint8Array(), 'cn-hang', () => markStarted());
    const rejected = expect(job).rejects.toMatchObject({ name: 'ConversionWorkerError', kind: 'stopped' });
    void job.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await started;
    const response = await fetch(`http://127.0.0.1:${api.port}/healthz`, {
      signal: AbortSignal.timeout(1000),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(settled).toBe(false);
    await instance.stop();
    await rejected;
    await expect(instance.convert(new Uint8Array(), 'cn-after-stop', () => undefined)).rejects.toMatchObject({
      kind: 'stopped',
    });
  });

  it('times out a blocked worker and converts the next job in a fresh worker', async () => {
    const instance = expiringOnBlock(converter(TIMEOUT_MS));
    await expect(instance.convert(new Uint8Array(), 'cn-hang', () => undefined)).rejects.toMatchObject({
      kind: 'timeout',
    });
    const result = await instance.convert(mapArchive(), 'cn-next', () => undefined);
    expect(result.maps[0]?.mapId).toBe('cn-next-island');
  });

  it('continues the service queue after a worker crash', async () => {
    const files = new FakeFiles();
    files.serve('cn-crash', mapArchive());
    files.serve('cn-next', mapArchive());
    const { service, served } = await harness(await directory(), files, {
      irVersion: IR_VERSION,
      converter: converter(),
    });
    service.setCatalog(syncedOf([catalogEntry('cn-crash'), catalogEntry('cn-next')]));
    await service.idle();
    expect(served('cn-crash').conversion).toMatchObject({ verdict: 'failed', reason: 'decode-failed' });
    expect(served('cn-next').conversion?.verdict).toBe('ok');
    await service.stop();
  });

  it('preserves the published generation when a replacement worker times out', async () => {
    const files = new FakeFiles();
    files.serve('cn-island', mapArchive());
    const dir = await directory();
    const { service, served } = await harness(dir, files, {
      irVersion: IR_VERSION,
      converter: expiringOnBlock(converter(TIMEOUT_MS)),
    });
    service.setCatalog(syncedOf([catalogEntry('cn-island')]));
    await service.idle();
    const manifestPath = join(dir, 'converted', String(IR_VERSION), 'cn-island', 'conversion.json');
    expect(served('cn-island').conversion?.verdict).toBe('ok');
    const before = await readFile(manifestPath, 'utf8');
    files.serve('cn-island', new Uint8Array([66]));
    service.setCatalog(syncedOf([catalogEntry('cn-island', { kind: 'archive' }, LATER)]));
    await service.idle();
    expect(served('cn-island').conversion?.verdict).toBe('ok');
    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    const sidecar = await service.file('cn-island-island', 'cn-island-island.json');
    expect(sidecar).not.toBeNull();
    await sidecar?.handle.close();
    await service.stop();
  });
});
