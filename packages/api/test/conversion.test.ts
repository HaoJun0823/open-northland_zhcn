import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { convertMapTree, MAP_FILE_SUFFIXES, mapFiles, openArchive } from '@open-northland/map-import';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/catalog/snapshot.js';
import {
  catalogEntry,
  FakeFiles,
  fileUrl,
  harness,
  plaintextMap,
  syncedOf,
  temporaryDir,
  UPDATED_AT,
  under,
  zipOf,
} from './support/conversion-fixture.js';

const ENTRY = 'cn-wyspa';
const LATER = '2025-01-01T00:00:00.000Z';
const OTHER_IR = IR_VERSION + 1;
const SMALL_LIMIT = 64;
const TIMEOUT_MS = 5000;
const LYING_EXTRA_BYTES = 10;

describe('ConversionService', () => {
  let dir: string;
  let files: FakeFiles;
  const converted = (version: number = IR_VERSION) => join(dir, 'converted', String(version), ENTRY);

  beforeEach(async () => {
    dir = await temporaryDir();
    files = new FakeFiles();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('converts a zip, keeps the archive and writes sidecars equal to a direct map-import run', async () => {
    const archive = zipOf(under('Wyspa', plaintextMap('Wyspa')));
    files.serve(ENTRY, archive);
    const { service, served, published } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    expect(served(ENTRY).conversion).toEqual({ verdict: 'pending' });
    expect(published.at(-1)?.conversions).toEqual({ converted: 0, pending: 1, failed: 0 });
    await service.idle();

    const conversion = served(ENTRY).conversion;
    if (conversion?.verdict !== 'ok') throw new Error(`not converted: ${JSON.stringify(conversion)}`);
    const mapId = `${ENTRY}-wyspa`;
    expect(conversion.irVersion).toBe(IR_VERSION);
    expect(conversion.maps.map((map) => [map.mapId, map.index.id, map.languages])).toEqual([
      [mapId, mapId, ['pol']],
    ]);
    expect(conversion.maps[0]?.index.minimap).toBe(false);
    expect(published.at(-1)?.conversions).toEqual({ converted: 1, pending: 0, failed: 0 });

    const direct = (await convertMapTree(await openArchive(archive), { provenance: 'catalog' })).maps[0];
    if (direct === undefined) throw new Error('no direct map');
    const expected = mapFiles({ ...direct, id: mapId, index: { ...direct.index, id: mapId } });
    const storedFiles = await readdir(converted());
    for (const [name, file] of expected) {
      const text = name.endsWith('.json');
      const bytes = text
        ? gunzipSync(await readFile(join(converted(), `${name}.gz`)))
        : await readFile(join(converted(), name));
      expect(bytes).toEqual(Buffer.from(file));
      if (text) expect(storedFiles).not.toContain(name);
    }
    const stored = JSON.parse(await readFile(join(converted(), 'conversion.json'), 'utf8'));
    expect(stored).toMatchObject({ conversion, updatedAt: UPDATED_AT });
    expect(await readdir(join(dir, 'archives', ENTRY))).toEqual([
      `${stored.archiveSha256}.zip`,
      'source.json',
    ]);
  });

  it('serves a campaign pack as two maps and numbers a repeated folder slug', async () => {
    files.serve(
      ENTRY,
      zipOf({
        ...under('Kampania/Glowna', plaintextMap('Glowna')),
        ...under('Kampania/Glowna_SUB1', {
          ...plaintextMap('Wyprawa'),
          'misc.inc': '[misc_maptype]\nmaptype 1\nmapcampaignid 0 7\n',
        }),
        ...under('Kopia/Glowna', plaintextMap('Kopia')),
      }),
    );
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    const conversion = served(ENTRY).conversion;
    if (conversion?.verdict !== 'ok') throw new Error('not converted');
    const ids = conversion.maps.map(({ mapId }) => mapId);
    expect(ids).toEqual([`${ENTRY}-glowna`, `${ENTRY}-glowna_sub1`, `${ENTRY}-glowna-2`]);
    expect(conversion.maps.map(({ folder }) => folder)).toEqual(['glowna', 'glowna_sub1', 'glowna']);
    for (const map of conversion.maps) expect(map.fingerprint).toBe(map.index.fingerprint);
    expect(conversion.maps[1]?.index.campaign).toEqual({ campaignId: 0, missionId: 7 });
    for (const mapId of ids) {
      expect(service.file(mapId, `${mapId}${MAP_FILE_SUFFIXES.terrain}`)).not.toBeNull();
    }
  });

  it('records a corrupt archive and a file of no known format as failed with the decoder reason', async () => {
    const corrupt = zipOf(under('Wyspa', plaintextMap('Wyspa'))).slice(0, SMALL_LIMIT);
    files.serve(ENTRY, corrupt);
    files.serve('cn-text', Buffer.from('not an archive at all'));
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY), catalogEntry('cn-text')]));
    await service.idle();
    expect(served(ENTRY).conversion).toMatchObject({ verdict: 'failed', reason: 'unsupported-archive' });
    expect(served('cn-text').conversion).toMatchObject({ verdict: 'failed', reason: 'unsupported-archive' });
    expect(await readdir(converted())).toEqual(['conversion.json']);
  });

  it('tries a stored failure once more per process from the kept archive', async () => {
    files.serve(ENTRY, Buffer.from('not an archive at all'));
    const first = await harness(dir, files, { irVersion: IR_VERSION });
    first.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await first.service.idle();
    expect(first.served(ENTRY).conversion?.verdict).toBe('failed');

    const restarted = await harness(dir, files, { irVersion: IR_VERSION });
    const conversionsOf = (events: typeof restarted.events) =>
      events.filter(({ event, fields }) => event === 'conversion done' && fields?.id === ENTRY).length;
    restarted.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await restarted.service.idle();
    expect(conversionsOf(restarted.events)).toBe(1);
    expect(files.requests).toEqual([fileUrl(ENTRY)]);
    expect(restarted.served(ENTRY).conversion?.verdict).toBe('failed');

    restarted.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await restarted.service.idle();
    expect(conversionsOf(restarted.events)).toBe(1);
  });

  it('links the kept file of a converted and of a failed entry, and drops it once its bytes change', async () => {
    const corrupt = zipOf(under('Wyspa', plaintextMap('Wyspa'))).slice(0, SMALL_LIMIT);
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    files.serve('cn-broken', corrupt);
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY), catalogEntry('cn-broken')]));
    expect(served(ENTRY).file).toEqual({ kind: 'archive' });
    await service.idle();

    expect(served('cn-broken').conversion).toMatchObject({
      verdict: 'failed',
      reason: 'unsupported-archive',
    });
    const brokenSha = sha256Hex(corrupt);
    expect(served('cn-broken').file).toEqual({
      kind: 'archive',
      bytes: corrupt.length,
      path: `/v1/maps/cn-broken/file?v=${brokenSha}`,
    });
    expect(await service.keptFile('cn-broken')).toEqual({
      bytes: Buffer.from(corrupt),
      sha256: brokenSha,
      name: 'cn-broken.zip',
    });
    expect(served(ENTRY).file).toMatchObject({ path: expect.stringMatching(`^/v1/maps/${ENTRY}/file\\?v=`) });

    await writeFile(join(dir, 'archives', 'cn-broken', `${brokenSha}.zip`), 'tampered');
    expect(await service.keptFile('cn-broken')).toBeNull();
    expect(await service.keptFile('cn-not-listed')).toBeNull();
  });

  it('records an archive without a map as no-map', async () => {
    files.serve(ENTRY, zipOf({ 'readme.txt': 'nothing here' }));
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    expect(served(ENTRY).conversion).toMatchObject({ verdict: 'failed', reason: 'no-map' });
  });

  it('retries a failed download with the next catalogue and stores nothing for it', async () => {
    files.responses.set(fileUrl(ENTRY), () => new Response('down', { status: 500 }));
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    expect(served(ENTRY).conversion).toMatchObject({
      verdict: 'failed',
      reason: 'download-failed',
      message: expect.stringContaining('500'),
    });
    expect(await readdir(join(dir, 'converted', String(IR_VERSION)))).toEqual([]);
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    expect(served(ENTRY).conversion?.verdict).toBe('ok');
  });

  it('fails a body shorter than its declared length as a download failure', async () => {
    const archive = zipOf(under('Wyspa', plaintextMap('Wyspa')));
    files.serve(ENTRY, archive, { 'content-length': String(archive.byteLength + LYING_EXTRA_BYTES) });
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    expect(served(ENTRY).conversion).toMatchObject({
      verdict: 'failed',
      reason: 'download-failed',
      message: expect.stringContaining('declared'),
    });
  });

  it('refuses a file over the archive limit, declared or received, as too-large', async () => {
    const archive = zipOf(under('Wyspa', plaintextMap('Wyspa')));
    files.serve(ENTRY, archive);
    files.responses.set(fileUrl('cn-undeclared'), () => new Response(new Uint8Array(archive)));
    const { service, served } = await harness(dir, files, {
      irVersion: IR_VERSION,
      downloadLimits: { maxBytes: SMALL_LIMIT, timeoutMs: TIMEOUT_MS },
    });
    service.setCatalog(syncedOf([catalogEntry(ENTRY), catalogEntry('cn-undeclared')]));
    await service.idle();
    expect(served(ENTRY).conversion).toMatchObject({ verdict: 'failed', reason: 'too-large' });
    expect(served('cn-undeclared').conversion).toMatchObject({ verdict: 'failed', reason: 'too-large' });
  });

  it('leaves an external entry alone and skips an entry already converted for its updatedAt', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    const external = catalogEntry('cn-elsewhere', { kind: 'external', url: 'https://example.com/map' });
    const first = await harness(dir, files, { irVersion: IR_VERSION });
    first.service.setCatalog(syncedOf([catalogEntry(ENTRY), external]));
    await first.service.idle();
    expect(first.served('cn-elsewhere').conversion).toBeUndefined();
    expect(files.requests).toEqual([fileUrl(ENTRY)]);

    const restarted = await harness(dir, files, { irVersion: IR_VERSION });
    restarted.service.setCatalog(syncedOf([catalogEntry(ENTRY), external]));
    await restarted.service.idle();
    expect(restarted.served(ENTRY).conversion?.verdict).toBe('ok');
    expect(files.requests).toHaveLength(1);

    restarted.service.setCatalog(syncedOf([catalogEntry(ENTRY, { kind: 'archive' }, LATER), external]));
    await restarted.service.idle();
    expect(files.requests).toHaveLength(2);
    expect(JSON.parse(await readFile(join(converted(), 'conversion.json'), 'utf8')).updatedAt).toBe(LATER);
  });

  it('removes another IR version on start and converts again from the kept archive', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    const old = await harness(dir, files, { irVersion: IR_VERSION });
    old.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await old.service.idle();
    await mkdir(join(dir, 'converted', 'stray'), { recursive: true });
    await writeFile(join(dir, 'converted', 'stray', 'x.json'), '{}');

    const bumped = await harness(dir, files, { irVersion: OTHER_IR });
    expect((await readdir(join(dir, 'converted'))).sort()).toEqual([String(OTHER_IR)]);
    expect(bumped.events.map(({ event }) => event)).toContain('converted versions removed');
    bumped.service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await bumped.service.idle();
    expect(bumped.served(ENTRY).conversion).toMatchObject({ verdict: 'ok', irVersion: OTHER_IR });
    expect(files.requests).toHaveLength(1);
    expect(await readdir(converted(OTHER_IR))).toContain('conversion.json');
  });

  it('prunes the archives and conversions of entries that left the catalogue', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    files.serve('cn-other', zipOf(under('Inna', plaintextMap('Inna'))));
    const { service } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY), catalogEntry('cn-other')]));
    await service.idle();
    service.setCatalog(syncedOf([catalogEntry(ENTRY, { kind: 'archive' }, LATER)]));
    await service.idle();
    expect(await readdir(join(dir, 'archives'))).toEqual([ENTRY]);
    expect(await readdir(join(dir, 'converted', String(IR_VERSION)))).toEqual([ENTRY]);
    expect(service.file('cn-other-inna', 'cn-other-inna.json')).toBeNull();
  });
});
