import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CatalogSync, syncCatalog } from '../src/catalog/sync.js';
import { DataStore } from '../src/store.js';
import {
  ACCEPTED_RECORDS,
  FakeUpstream,
  PNG_BYTES,
  REFUSED_RECORDS,
  strapiRecord,
  UPSTREAM,
} from './support/strapi-fixture.js';

const HOUR_MS = 3_600_000;

describe('syncCatalog', () => {
  let dir: string;
  let store: DataStore;
  const events: string[] = [];
  const log = (event: string) => {
    events.push(event);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-sync-'));
    store = new DataStore(dir);
    await store.init();
    events.length = 0;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const readCatalog = async () =>
    Catalog.parse(JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8')));

  it('writes the catalogue, the raw pages and the thumbnails', async () => {
    const upstream = new FakeUpstream([
      [...ACCEPTED_RECORDS.slice(0, 3), ...REFUSED_RECORDS],
      ACCEPTED_RECORDS.slice(3),
    ]);
    const snapshot = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const catalog = await readCatalog();
    expect(catalog).toHaveLength(ACCEPTED_RECORDS.length);
    expect(snapshot.entries.size).toBe(ACCEPTED_RECORDS.length);
    expect((await readdir(join(dir, 'raw'))).sort()).toEqual(['1.json', '2.json']);
    expect(events.filter((event) => event === 'record skipped')).toHaveLength(REFUSED_RECORDS.length);
    const withThumbnail = catalog.filter((entry) => entry.thumbnail !== undefined);
    expect(withThumbnail).toHaveLength(ACCEPTED_RECORDS.length - 1);
    const first = withThumbnail[0];
    expect(first?.thumbnail).toBe(`/v1/maps/${first?.id}/thumbnail`);
    expect(await store.readThumbnail(first?.id ?? '')).toEqual({
      bytes: PNG_BYTES,
      contentType: 'image/png',
    });
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps ids and the catalogue bytes stable across syncs of the same input', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const first = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const second = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect([...second.entries.keys()]).toEqual([...first.entries.keys()]);
    expect(second.catalog.etag).toBe(first.catalog.etag);
  });

  it('fetches a thumbnail once and again only when updatedAt changes', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const fetchedFirst = upstream.thumbnailRequests().length;
    expect(fetchedFirst).toBe(ACCEPTED_RECORDS.length - 1);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(upstream.thumbnailRequests()).toHaveLength(fetchedFirst);
    const changed = strapiRecord({
      id: 11,
      documentId: 'AbCdEf0123456789ghijklmn',
      title: 'Frozen Fjord',
      category: 'Mapy Singleplayer',
      fileUrl: 'https://culturesnation.pl/downloads/frozen_fjord.rar',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    upstream.pages = [[changed, ...ACCEPTED_RECORDS.slice(1)]];
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(upstream.thumbnailRequests()).toHaveLength(fetchedFirst + 1);
  });

  it('drops the raw pages and thumbnails of a shrunk catalogue', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS.slice(0, 2), ACCEPTED_RECORDS.slice(2)]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    upstream.pages = [ACCEPTED_RECORDS.slice(0, 1)];
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(await readdir(join(dir, 'raw'))).toEqual(['1.json']);
    expect(await readdir(join(dir, 'thumbnails'))).toHaveLength(2);
  });

  it('keeps the last good catalogue when the upstream fails', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const before = await readFile(join(dir, 'catalog.json'), 'utf8');
    upstream.failing = true;
    await expect(syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log })).rejects.toThrow();
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(before);
    expect(await readdir(join(dir, 'raw'))).toEqual(['1.json']);
  });
});

describe('CatalogSync', () => {
  it('publishes a good run, logs a failed one and stops cleanly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'on-api-loop-'));
    const store = new DataStore(dir);
    await store.init();
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const events: string[] = [];
    const published: number[] = [];
    const options = {
      fetch: upstream.fetch,
      upstream: UPSTREAM,
      store,
      log: (event: string) => events.push(event),
    };
    const good = new CatalogSync(options, HOUR_MS, (snapshot) => published.push(snapshot.entries.size));
    good.start();
    await good.stop();
    expect(published).toEqual([ACCEPTED_RECORDS.length]);
    upstream.failing = true;
    const bad = new CatalogSync(options, HOUR_MS, (snapshot) => published.push(snapshot.entries.size));
    bad.start();
    await bad.stop();
    expect(published).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining(['sync done', 'sync failed']));
    await rm(dir, { recursive: true, force: true });
  });
});
