import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeC2m } from '../../formats/test/fixtures/c2m.js';
import { detectArchiveFormat, openArchive, openC2m, openRar, openZip } from '../src/archives/open.js';
import { MapImportError, type MapImportFailure } from '../src/errors.js';
import { DEFAULT_IMPORT_LIMITS } from '../src/limits.js';
import { encodeRar4 } from './support/rar.js';
import { unrarWasm } from './support/unrar.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const MAP_DAT = bytes(1, 2, 3);
const MISC = bytes(4, 5);

async function failure(promise: Promise<unknown>): Promise<MapImportFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MapImportError) return err.kind;
    throw err;
  }
  throw new Error('expected a MapImportError');
}

/** Sets general-purpose flag bit 0 (encrypted) on every local and central header of a zip. */
function markZipEncrypted(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let at = 0; at + 4 <= out.length; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50) view.setUint16(at + 6, view.getUint16(at + 6, true) | 1, true);
    if (signature === 0x02014b50) view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true);
  }
  return out;
}

describe('openZip', () => {
  it('keeps only map files, keyed lower-case with their spelling kept', async () => {
    const zip = zipSync({
      'Pack/Main/MAP.DAT': MAP_DAT,
      'Pack/Main/misc.inc': MISC,
      'Pack/Main/Text/Pol/strings.ini': bytes(6),
      'Pack/readme.txt': bytes(7),
      'Pack/Main/text/pol/briefings/Palettes/font.pcx': bytes(8),
    });
    const tree = await openZip(zip);
    expect([...tree.files.keys()].sort()).toEqual([
      'pack/main/map.dat',
      'pack/main/misc.inc',
      'pack/main/text/pol/strings.ini',
    ]);
    expect(tree.names.get('pack/main/map.dat')).toBe('Pack/Main/MAP.DAT');
    expect(Array.from(tree.files.get('pack/main/map.dat') ?? [])).toEqual([1, 2, 3]);
  });

  it('opens a nested .c2m one level deep under its own path without the extension', async () => {
    const c2m = encodeC2m({ 'map.dat': MAP_DAT, 'text/pol/strings.cif': bytes(9) });
    const tree = await openZip(zipSync({ 'TGC_Polski.c2m': c2m, 'notes.txt': bytes(1) }));
    expect([...tree.files.keys()].sort()).toEqual(['tgc_polski/map.dat', 'tgc_polski/text/pol/strings.cif']);
  });

  it('opens a nested archive by its leading bytes when the extension lies', async () => {
    const tree = await openZip(zipSync({ 'Pack.rar': zipSync({ 'Map/map.dat': MAP_DAT }) }));
    expect([...tree.files.keys()]).toEqual(['pack/map/map.dat']);
  });

  it('ignores an archive nested two levels deep', async () => {
    const inner = zipSync({ 'Deep/map.dat': MAP_DAT });
    const middle = zipSync({ 'inner.zip': inner, 'Mid/map.dat': MAP_DAT });
    const tree = await openZip(zipSync({ 'middle.zip': middle }));
    expect([...tree.files.keys()]).toEqual(['middle/mid/map.dat']);
  });

  it('fails a truncated archive, an encrypted map entry and a traversing path as unsupported', async () => {
    const zip = zipSync({ 'Map/map.dat': MAP_DAT });
    expect(await failure(openZip(zip.subarray(0, zip.length - 10)))).toBe('unsupported-archive');
    expect(await failure(openZip(markZipEncrypted(zip)))).toBe('unsupported-archive');
    expect(await failure(openZip(zipSync({ '../map.dat': MAP_DAT })))).toBe('unsupported-archive');
    expect(await failure(openZip(zipSync({ 'C:/Map/map.dat': MAP_DAT })))).toBe('unsupported-archive');
  });

  it('fails two entries that fold onto one path', async () => {
    expect(await failure(openZip(zipSync({ 'Map/map.dat': MAP_DAT, 'MAP/Map.dat': MAP_DAT })))).toBe(
      'unsupported-archive',
    );
  });

  it('enforces every caller-supplied limit as too-large', async () => {
    const zip = zipSync({ 'Map/map.dat': new Uint8Array(100), 'Map/misc.inc': MISC, 'a.txt': bytes(1) });
    const limited = (limits: Partial<typeof DEFAULT_IMPORT_LIMITS>) =>
      failure(openZip(zip, { limits: { ...DEFAULT_IMPORT_LIMITS, ...limits } }));
    expect(await limited({ archiveBytes: zip.length - 1 })).toBe('too-large');
    expect(await limited({ entryBytes: 99 })).toBe('too-large');
    expect(await limited({ unpackedBytes: 101 })).toBe('too-large');
    expect(await limited({ entries: 2 })).toBe('too-large');
    expect(await limited({ depth: 1 })).toBe('too-large');
    expect((await openZip(zip, { limits: { ...DEFAULT_IMPORT_LIMITS, entries: 3 } })).files.size).toBe(2);
  });
});

describe('openC2m', () => {
  it('drops the currentusermap export root so the map sits at the tree root', async () => {
    const tree = await openC2m(encodeC2m({ 'map.dat': MAP_DAT, 'text/pol/briefings/font12.fnt': bytes(1) }));
    expect([...tree.files.keys()]).toEqual(['map.dat']);
  });

  it('fails a corrupt directory as unsupported', async () => {
    const c2m = encodeC2m({ 'map.dat': MAP_DAT });
    expect(await failure(openC2m(c2m.subarray(0, c2m.length - 1)))).toBe('unsupported-archive');
  });
});

describe('openRar', () => {
  it('keeps the map files of a plain RAR4 archive', async () => {
    const rar = encodeRar4([
      { path: 'Mapa/map.dat', bytes: MAP_DAT },
      { path: 'Mapa/misc.inc', bytes: MISC },
      { path: 'Mapa/readme.txt', bytes: bytes(1) },
    ]);
    const tree = await openRar(rar, unrarWasm());
    expect([...tree.files.keys()].sort()).toEqual(['mapa/map.dat', 'mapa/misc.inc']);
    expect(Array.from(tree.files.get('mapa/misc.inc') ?? [])).toEqual([4, 5]);
  });

  it('fails a passworded map entry as unsupported, but ignores a passworded stray file', async () => {
    const locked = encodeRar4([{ path: 'Mapa/map.dat', bytes: MAP_DAT, passworded: true }]);
    expect(await failure(openRar(locked, unrarWasm()))).toBe('unsupported-archive');
    const strayLocked = encodeRar4([
      { path: 'Mapa/map.dat', bytes: MAP_DAT },
      { path: 'Mapa/secret.txt', bytes: bytes(1), passworded: true },
    ]);
    expect([...(await openRar(strayLocked, unrarWasm())).files.keys()]).toEqual(['mapa/map.dat']);
  });

  it('opens a RAR nested in a zip when the wasm is given, and fails it without', async () => {
    const zip = zipSync({ 'KingDE.rar': encodeRar4([{ path: 'King/map.dat', bytes: MAP_DAT }]) });
    expect([...(await openZip(zip, { unrarWasm: unrarWasm() })).files.keys()]).toEqual([
      'kingde/king/map.dat',
    ]);
    expect(await failure(openZip(zip))).toBe('unsupported-archive');
  });
});

describe('openArchive', () => {
  it('tells the formats apart by their leading bytes', async () => {
    const rar = encodeRar4([{ path: 'R/map.dat', bytes: MAP_DAT }]);
    expect(detectArchiveFormat(zipSync({ 'a/map.dat': MAP_DAT }))).toBe('zip');
    expect(detectArchiveFormat(rar)).toBe('rar');
    expect(detectArchiveFormat(encodeC2m({ 'map.dat': MAP_DAT }))).toBe('c2m');
    expect([...(await openArchive(rar, { unrarWasm: unrarWasm() })).files.keys()]).toEqual(['r/map.dat']);
    expect(await failure(openArchive(bytes(0x1f, 0x8b, 8, 0)))).toBe('unsupported-archive');
  });
});
