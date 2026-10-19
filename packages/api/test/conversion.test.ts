import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { convertMapTree, MAP_FILE_SUFFIXES, mapFiles, openArchive } from '@open-northland/map-import';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMapDat } from '../../formats/test/fixtures/mapdat.js';
import { sha256Hex } from '../src/catalog/snapshot.js';
import { type CatalogMapOverlays, NO_MAP_OVERLAYS } from '../src/conversion/overlays.js';
import type { ConversionService } from '../src/conversion/service.js';
import { ConversionStore } from '../src/conversion/store.js';
import * as storeIo from '../src/store.js';
import {
  catalogEntry,
  FakeFiles,
  fileUrl,
  harness,
  overlaysFor,
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
/** A 2x1 map.dat whose cells differ from `plaintextMap`'s, so its overlays are filed apart. */
const OTHER_MAP_DAT = buildMapDat(2, 1, [5, 5, 2, 2, 5, 5, 2, 2]);

/** The strings sidecar the service serves for `mapId`, inflated. */
async function servedStrings(service: ConversionService, mapId: string): Promise<unknown> {
  const file = await service.file(mapId, `${mapId}${MAP_FILE_SUFFIXES.strings}`);
  if (file === null) throw new Error(`no strings sidecar for ${mapId}`);
  const bytes = await file.handle.readFile().finally(() => file.handle.close());
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

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
    const stored = JSON.parse(await readFile(join(converted(), 'conversion.json'), 'utf8'));
    const generation = join(converted(), stored.generation);
    const storedFiles = await readdir(generation);
    for (const [name, file] of expected) {
      const text = name.endsWith('.json');
      const bytes = text
        ? gunzipSync(await readFile(join(generation, `${name}.gz`)))
        : await readFile(join(generation, name));
      expect(bytes).toEqual(Buffer.from(file));
      if (text) expect(storedFiles).not.toContain(name);
    }
    expect(stored).toMatchObject({ conversion, updatedAt: UPDATED_AT });
    expect(await readdir(join(dir, 'archives', ENTRY))).toEqual([
      `${stored.archiveSha256}.zip`,
      'source.json',
    ]);
  });

  it('applies the overlays filed under an archive map digest, a source language included', async () => {
    const archive = zipOf(under('Wyspa', plaintextMap('Wyspa')));
    files.serve(ENTRY, archive);
    const mapOverlays = await overlaysFor(archive, 'wyspa', {
      eng: { '0': 'Island' },
      chs: { '0': '岛屿', '1': '描述' },
    });
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION, mapOverlays });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();

    const conversion = served(ENTRY).conversion;
    if (conversion?.verdict !== 'ok') throw new Error(`not converted: ${JSON.stringify(conversion)}`);
    expect(conversion.maps[0]?.languages).toEqual(['pol', 'eng', 'chs']);
    expect(await servedStrings(service, `${ENTRY}-wyspa`)).toEqual({
      pol: { '0': 'Wyspa', '1': 'Opis' },
      eng: { '0': 'Island' },
      chs: { '0': '岛屿', '1': '描述' },
    });
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
      const file = await service.file(mapId, `${mapId}${MAP_FILE_SUFFIXES.terrain}`);
      expect(file).not.toBeNull();
      await file?.handle.close();
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
    const stored = JSON.parse(await readFile(join(converted(), 'conversion.json'), 'utf8'));
    expect(await readdir(join(converted(), stored.generation))).toEqual([]);
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
    const kept = await service.keptFile('cn-broken');
    expect(kept).toMatchObject({ sha256: brokenSha, name: 'cn-broken.zip' });
    if (kept === null) throw new Error('kept archive missing');
    try {
      expect(await kept.handle.readFile()).toEqual(Buffer.from(corrupt));
    } finally {
      await kept.handle.close();
    }
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

  it('aborts an in-flight download on shutdown without persisting a failed generation', async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const { service } = await harness(
      dir,
      {
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('download aborted')), {
              once: true,
            });
            markStarted();
          }),
      },
      { irVersion: IR_VERSION },
    );
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await started;
    await service.stop();
    expect(await readdir(join(dir, 'converted', String(IR_VERSION)))).toEqual([]);
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

  it('converts again from the kept archive only the entries whose map overlays changed', async () => {
    const island = zipOf(under('Wyspa', plaintextMap('Wyspa')));
    const other = zipOf(under('Inna', { ...plaintextMap('Inna'), 'map.dat': OTHER_MAP_DAT }));
    const otherEntry = 'cn-inna';
    files.serve(ENTRY, island);
    files.serve(otherEntry, other);
    const islandMap = `${ENTRY}-wyspa`;
    const restart = async (mapOverlays: CatalogMapOverlays) => {
      const run = await harness(dir, files, { irVersion: IR_VERSION, mapOverlays });
      run.service.setCatalog(syncedOf([catalogEntry(ENTRY), catalogEntry(otherEntry)]));
      await run.service.idle();
      const converted = run.events.filter(({ event }) => event === 'conversion done');
      return { ...run, converted: converted.map(({ fields }) => fields?.id) };
    };

    const first = await restart(await overlaysFor(island, 'wyspa', { chs: { '0': '岛屿' } }));
    expect(first.converted).toEqual([ENTRY, otherEntry]);
    const unchanged = await restart(await overlaysFor(island, 'wyspa', { chs: { '0': '岛屿' } }));
    expect(unchanged.converted).toEqual([]);

    const changed = await restart(await overlaysFor(island, 'wyspa', { chs: { '0': '小岛' } }));
    expect(changed.converted).toEqual([ENTRY]);
    expect(await servedStrings(changed.service, islandMap)).toMatchObject({ chs: { '0': '小岛' } });

    const removed = await restart(NO_MAP_OVERLAYS);
    expect(removed.converted).toEqual([ENTRY]);
    const conversion = removed.served(ENTRY).conversion;
    expect(conversion?.verdict === 'ok' ? conversion.maps[0]?.languages : null).toEqual(['pol']);

    const filedLater = await restart(await overlaysFor(other, 'inna', { cht: { '0': '其他' } }));
    expect(filedLater.converted).toEqual([otherEntry]);
    expect(files.requests).toEqual([fileUrl(ENTRY), fileUrl(otherEntry)]);
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
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    expect(await readdir(join(dir, 'archives'))).toEqual([ENTRY]);
    expect(await readdir(join(dir, 'converted', String(IR_VERSION)))).toEqual([ENTRY]);
    expect(await service.file('cn-other-inna', 'cn-other-inna.json')).toBeNull();
    expect(files.requests).toEqual([fileUrl(ENTRY), fileUrl('cn-other')]);
  });

  it('keeps the last published conversion when replacement manifest publication fails', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('First'))));
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    const before = served(ENTRY).conversion;
    const manifest = await readFile(join(converted(), 'conversion.json'), 'utf8');
    const write = storeIo.writeAtomic;
    const fault = vi
      .spyOn(storeIo, 'writeAtomic')
      .mockImplementation((path, bytes) =>
        path === join(converted(), 'conversion.json')
          ? Promise.reject(new Error('publication failed'))
          : write(path, bytes),
      );
    try {
      files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Replacement'))));
      service.setCatalog(syncedOf([catalogEntry(ENTRY, { kind: 'archive' }, LATER)]));
      await service.idle();
    } finally {
      fault.mockRestore();
    }
    expect(await readFile(join(converted(), 'conversion.json'), 'utf8')).toBe(manifest);
    expect(served(ENTRY).conversion).toEqual(before);
    const file = await service.file(`${ENTRY}-wyspa`, `${ENTRY}-wyspa.strings.json`);
    if (file === null) throw new Error('previous strings missing');
    try {
      expect(gunzipSync(await file.handle.readFile()).toString()).toContain('First');
    } finally {
      await file.handle.close();
    }
    expect(await readdir(converted())).toHaveLength(2);
  });

  it('reconverts an entry restored by a sync while its previous files are being pruned', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Wyspa'))));
    const { service, served } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    let markRemoved: () => void = () => undefined;
    const removed = new Promise<void>((resolve) => {
      markRemoved = resolve;
    });
    let resume: () => void = () => undefined;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const prune = ConversionStore.prototype.prune;
    const pause = vi.spyOn(ConversionStore.prototype, 'prune').mockImplementationOnce(async function (
      this: ConversionStore,
      keep,
    ) {
      const result = await prune.call(this, keep);
      markRemoved();
      await resumed;
      return result;
    });
    try {
      service.setCatalog(syncedOf([]));
      await removed;
      service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
      resume();
      await service.idle();
      expect(served(ENTRY).conversion?.verdict).toBe('ok');
      const file = await service.file(`${ENTRY}-wyspa`, `${ENTRY}-wyspa.json`);
      expect(file).not.toBeNull();
      await file?.handle.close();
      expect(await readdir(join(dir, 'archives'))).toEqual([ENTRY]);
    } finally {
      resume();
      pause.mockRestore();
    }
  });

  it('holds an in-flight reader on its old generation while publishing and pruning its replacement', async () => {
    files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('First'))));
    const { service } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    const mapId = `${ENTRY}-wyspa`;
    const old = await service.file(mapId, `${mapId}.strings.json`);
    if (old === null) throw new Error('old strings missing');
    try {
      files.serve(ENTRY, zipOf(under('Wyspa', plaintextMap('Replacement'))));
      service.setCatalog(syncedOf([catalogEntry(ENTRY, { kind: 'archive' }, LATER)]));
      await service.idle();
      const current = await service.file(mapId, `${mapId}.strings.json`);
      if (current === null) throw new Error('replacement strings missing');
      try {
        const previousBytes = gunzipSync(await old.handle.readFile());
        const currentBytes = gunzipSync(await current.handle.readFile());
        expect(previousBytes.toString()).toContain('First');
        expect(currentBytes.toString()).toContain('Replacement');
        expect(old.etag).toBe(`"${sha256Hex(previousBytes)}"`);
        expect(current.etag).toBe(`"${sha256Hex(currentBytes)}"`);
        expect(current.etag).not.toBe(old.etag);
      } finally {
        await current.handle.close();
      }
    } finally {
      await old.handle.close();
    }
    const store = new ConversionStore(dir, IR_VERSION);
    const manifest = (await store.readConversions()).get(ENTRY);
    expect((await readdir(converted())).sort()).toEqual([manifest?.generation, 'conversion.json'].sort());
  });

  it('keeps a verified archive reader intact after a different archive replaces it', async () => {
    const first = zipOf(under('Wyspa', plaintextMap('First')));
    const replacement = zipOf(under('Wyspa', plaintextMap('Replacement')));
    files.serve(ENTRY, first);
    const { service } = await harness(dir, files, { irVersion: IR_VERSION });
    service.setCatalog(syncedOf([catalogEntry(ENTRY)]));
    await service.idle();
    const old = await service.keptFile(ENTRY);
    if (old === null) throw new Error('old archive missing');
    try {
      files.serve(ENTRY, replacement);
      service.setCatalog(syncedOf([catalogEntry(ENTRY, { kind: 'archive' }, LATER)]));
      await service.idle();
      const current = await service.keptFile(ENTRY);
      if (current === null) throw new Error('replacement archive missing');
      try {
        expect(await old.handle.readFile()).toEqual(Buffer.from(first));
        expect(await current.handle.readFile()).toEqual(Buffer.from(replacement));
        expect(old.sha256).toBe(sha256Hex(first));
        expect(current.sha256).toBe(sha256Hex(replacement));
        expect(await readdir(join(dir, 'archives', ENTRY))).toEqual([`${current.sha256}.zip`, 'source.json']);
      } finally {
        await current.handle.close();
      }
    } finally {
      await old.handle.close();
    }
  });
});
