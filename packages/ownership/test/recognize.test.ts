import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { findInstall, isLibraryHead, recognizeInstall, releaseLabel } from '../src/index.js';
import { ascii, cifHead, libraryHead, memoryReader } from './memory-reader.js';

const WONDERS_EN_LIBRARY_SIZE = 255_230_793;

describe('library layout', () => {
  test('recognizes a packed install by the library head and labels a known size', async () => {
    const reader = memoryReader({
      'Game.exe': ascii('MZ'),
      DataX: {
        Libs: { 'data0001.lib': libraryHead({ totalSize: WONDERS_EN_LIBRARY_SIZE }), 't.dat': ascii('x') },
      },
    });
    assert.deepEqual(await recognizeInstall(reader), {
      path: [],
      layout: 'library',
      game: 'wonders',
      edition: 'EN',
    });
  });

  test('matches folder names in any casing and keeps an unlisted size unlabeled', async () => {
    const reader = memoryReader({
      'GAME.EXE': ascii('MZ'),
      datax: { LIBS: { 'DATA0001.LIB': libraryHead({ totalSize: 1000 }) } },
    });
    const install = await recognizeInstall(reader);
    assert.equal(install?.layout, 'library');
    assert.equal(install?.game, undefined);
  });

  test('rejects a library with another first directory or version', async () => {
    assert.equal(isLibraryHead(libraryHead({ firstName: 'maps\\' })), false);
    const wrongVersion = libraryHead();
    wrongVersion[0] = 2;
    assert.equal(isLibraryHead(wrongVersion), false);
    assert.equal(isLibraryHead(new Uint8Array(8)), false);
    const reader = memoryReader({
      DataX: { Libs: { 'data0001.lib': ascii('not a library at all, just text') } },
    });
    assert.equal(await recognizeInstall(reader), undefined);
  });
});

describe('loose layout', () => {
  test('recognizes an unpacked data tree by the probe file header', async () => {
    const reader = memoryReader({
      Data: { logic: { 'housetypes.cif': cifHead(), 'goodtypes.ini': ascii('[good]') } },
    });
    assert.deepEqual(await recognizeInstall(reader), {
      path: [],
      layout: 'loose',
      game: undefined,
      edition: undefined,
    });
  });

  test('a library beside an unpacked tree keeps the library label', async () => {
    const reader = memoryReader({
      DataX: { Libs: { 'data0001.lib': libraryHead({ totalSize: WONDERS_EN_LIBRARY_SIZE }) } },
      Data: { logic: { 'housetypes.cif': cifHead() } },
    });
    const install = await recognizeInstall(reader);
    assert.equal(install?.layout, 'library');
    assert.equal(install?.game, 'wonders');
  });

  test('rejects a loose tree whose probe file has another header', async () => {
    const reader = memoryReader({ Data: { logic: { 'housetypes.cif': ascii('<html>') } } });
    assert.equal(await recognizeInstall(reader), undefined);
  });
});

describe('bundle layout', () => {
  test('recognizes a Mac App Store bundle by identifier and asset archive', async () => {
    const plist = ascii(
      '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.rune-soft.culturesnorthland</string></dict></plist>',
    );
    const reader = memoryReader({
      Contents: {
        'Info.plist': plist,
        Resources: { 'DesktopAssets.zip': ascii('PK') },
        MacOS: { Wonders: ascii('') },
      },
    });
    assert.deepEqual(await recognizeInstall(reader), {
      path: [],
      layout: 'bundle',
      game: 'northland',
      edition: 'Mac App Store',
    });
  });

  test('rejects another publisher bundle and a bundle without the assets', async () => {
    const other = memoryReader({
      Contents: { 'Info.plist': ascii('com.example.other'), Resources: { 'DesktopAssets.zip': ascii('PK') } },
    });
    assert.equal(await recognizeInstall(other), undefined);
    const empty = memoryReader({
      Contents: { 'Info.plist': ascii('com.rune-soft.cultureswonders'), Resources: {} },
    });
    assert.equal(await recognizeInstall(empty), undefined);
  });
});

describe('findInstall', () => {
  test('looks one level down for the install and reports its folder', async () => {
    const reader = memoryReader({
      'Some Other Game': { 'readme.txt': ascii('') },
      'Cultures Northland': { DataX: { Libs: { 'data0001.lib': libraryHead({ totalSize: 234_653_915 }) } } },
    });
    const install = await findInstall(reader);
    assert.deepEqual(install?.path, ['Cultures Northland']);
    assert.equal(install?.game, 'northland');
  });

  test('returns nothing for an unrelated folder', async () => {
    const reader = memoryReader({ docs: { 'a.txt': ascii('') }, 'b.txt': ascii('') });
    assert.equal(await findInstall(reader), undefined);
  });
});

describe('releaseLabel', () => {
  test('names a known release with its title and edition', () => {
    assert.equal(releaseLabel('northland', 'PL'), 'Cultures: Northland (PL)');
    assert.equal(releaseLabel('wonders', undefined), 'Cultures: 8th Wonder of the World');
    assert.equal(releaseLabel(undefined, undefined), null);
  });
});
