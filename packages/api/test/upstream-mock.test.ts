import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/catalog/snapshot.js';
import { syncCatalog } from '../src/catalog/sync.js';
import { DataStore } from '../src/store.js';
import { startUpstreamMock, type UpstreamMock } from '../src/upstream-mock/server.js';
import { harness, plaintextMap, temporaryDir, under, zipOf } from './support/conversion-fixture.js';
import { PNG_BYTES, strapiPage, strapiRecord } from './support/strapi-fixture.js';

const DOCUMENT_ID = 'WyspaWyspaWyspaWyspa0001';
const ENTRY = 'cn-wyspawyspawyspawyspa0001';
const FILE_URL = 'https://culturesnation.pl/downloads/wyspa.zip';
const EXTERNAL_URL = 'https://files.example.com/wyspa2.zip';
const ARCHIVE = zipOf(under('Wyspa', plaintextMap('Wyspa')));

/** A download cache laid out as the mock reads it, with one archive entry and one external one. */
async function writeCache(dir: string): Promise<void> {
  const records = [
    strapiRecord({
      id: 1,
      documentId: DOCUMENT_ID,
      title: 'Wyspa',
      category: 'Mapy Singleplayer',
      fileUrl: FILE_URL,
    }),
    strapiRecord({
      id: 2,
      documentId: 'externalexternalexternal',
      title: 'Elsewhere',
      category: 'Kampanie',
      fileUrl: EXTERNAL_URL,
      screenshot: null,
    }),
  ];
  await mkdir(join(dir, 'raw'), { recursive: true });
  await writeFile(join(dir, 'raw', '1.json'), JSON.stringify(strapiPage(records, 1, 1)));
  const sha256 = sha256Hex(ARCHIVE);
  await mkdir(join(dir, 'archives', ENTRY), { recursive: true });
  await writeFile(join(dir, 'archives', ENTRY, `${sha256}.zip`), ARCHIVE);
  await writeFile(
    join(dir, 'archives', ENTRY, 'source.json'),
    JSON.stringify({ sha256, ext: 'zip', updatedAt: '2024-03-02T11:00:00.000Z', url: FILE_URL }),
  );
  await mkdir(join(dir, 'thumbnails'), { recursive: true });
  await writeFile(join(dir, 'thumbnails', ENTRY), PNG_BYTES);
  await writeFile(join(dir, 'thumbnails', `${ENTRY}.json`), JSON.stringify({ contentType: 'image/png' }));
}

describe('upstream mock', () => {
  let cacheDir: string;
  let dataDir: string;
  let mock: UpstreamMock;
  const requests: string[] = [];

  beforeEach(async () => {
    cacheDir = await temporaryDir();
    dataDir = await temporaryDir();
    await writeCache(cacheDir);
    requests.length = 0;
    mock = await startUpstreamMock({
      cacheDir,
      port: 0,
      host: '127.0.0.1',
      log: (event, fields) => {
        if (event === 'request') requests.push(String(fields?.path));
      },
    });
  });
  afterEach(async () => {
    await mock.close();
    await rm(cacheDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('rewrites catalogue URLs to itself and answers past the last page with no data', async () => {
    const first = await (await fetch(`${mock.origin}/api/downloads?pagination[page]=1`)).json();
    expect(first.data.map((record: { fileUrl: string }) => record.fileUrl)).toEqual([
      `${mock.origin}/downloads/wyspa.zip`,
      EXTERNAL_URL,
    ]);
    const beyond = await (await fetch(`${mock.origin}/api/downloads?pagination[page]=2`)).json();
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.pagination.pageCount).toBe(1);
    expect((await fetch(`${mock.origin}/downloads/missing.zip`)).status).toBe(404);
  });

  it('feeds a real sync and conversion end to end without another host', async () => {
    const store = new DataStore(dataDir);
    await store.init();
    const synced = await syncCatalog({ fetch, upstream: mock.origin, store, log: () => undefined });
    const entry = synced.catalog.find(({ id }) => id === ENTRY);
    expect(entry?.thumbnail).toBeDefined();
    expect(synced.downloads.get(ENTRY)).toBe(`${mock.origin}/downloads/wyspa.zip`);
    const { service, served } = await harness(dataDir, { fetch }, { irVersion: IR_VERSION });
    service.setCatalog(synced);
    await service.idle();
    const conversion = served(ENTRY).conversion;
    expect(conversion).toMatchObject({ verdict: 'ok', maps: [{ mapId: `${ENTRY}-wyspa` }] });
    expect(served(ENTRY).file).toEqual({
      kind: 'archive',
      bytes: ARCHIVE.byteLength,
      path: `/v1/maps/${ENTRY}/file?v=${sha256Hex(ARCHIVE)}`,
    });
    expect(requests).toEqual(expect.arrayContaining(['/downloads/wyspa.zip', '/uploads/small_shot_1.png']));
  });
});
