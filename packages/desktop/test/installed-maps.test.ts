import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installedMapPath,
  MAX_INSTALLED_MAP_FILE_BYTES,
  parseInstalledMapFileWrite,
  removeInstalledMap,
  writeInstalledMapFile,
} from '../src/installed-maps.js';
import { installedMapsRoot } from '../src/paths.js';
import { servedFile } from '../src/static-files.js';

const BYTES = new TextEncoder().encode('{}');

describe('installed map writes from the renderer', () => {
  it('accepts a plain map id, a known sidecar and non-empty bytes', () => {
    expect(parseInstalledMapFileWrite('cn-zatoka_2', '.script.json', BYTES)).toEqual({
      mapId: 'cn-zatoka_2',
      suffix: '.script.json',
      bytes: BYTES,
    });
  });

  it.each([
    ['a path in the id', '../escape', '.json', BYTES, /map id/],
    ['a separator in the id', 'a/b', '.json', BYTES, /map id/],
    ['an over-long id', 'x'.repeat(129), '.json', BYTES, /map id/],
    ['a non-string id', 7, '.json', BYTES, /map id/],
    ['an unknown suffix', 'zatoka', '.exe', BYTES, /suffix/],
    ['a suffix with a path', 'zatoka', '/../x.json', BYTES, /suffix/],
    ['bytes that are not bytes', 'zatoka', '.json', '{}', /bytes/],
    ['an empty file', 'zatoka', '.json', new Uint8Array(0), /bytes/],
    ['an oversized file', 'zatoka', '.json', new Uint8Array(MAX_INSTALLED_MAP_FILE_BYTES + 1), /size limit/],
  ])('refuses %s', (_name, mapId, suffix, bytes, error) => {
    expect(() => parseInstalledMapFileWrite(mapId, suffix, bytes)).toThrow(error);
  });
});

describe('installed maps on disk', () => {
  let tmp: string;
  let roots: { appRoot: string; contentRoot: string };
  let mapsRoot: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'opennorthland-installed-'));
    roots = { appRoot: join(tmp, 'app'), contentRoot: join(tmp, 'content') };
    mapsRoot = installedMapsRoot(join(tmp, 'profile'));
    await mkdir(join(roots.appRoot), { recursive: true });
    await mkdir(join(roots.contentRoot, 'maps'), { recursive: true });
    await writeFile(join(roots.appRoot, 'index.html'), 'app');
    await writeFile(join(roots.contentRoot, 'maps', 'shipped.json'), 'content');
  });

  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('writes one folder per map and removes it whole', async () => {
    await writeInstalledMapFile(mapsRoot, parseInstalledMapFileWrite('cn-a', '.json', BYTES));
    await writeInstalledMapFile(mapsRoot, parseInstalledMapFileWrite('cn-a', '.meta.json', BYTES));
    expect((await readdir(join(mapsRoot, 'cn-a'))).sort()).toEqual(['cn-a.json', 'cn-a.meta.json']);
    await removeInstalledMap(mapsRoot, 'cn-a');
    expect(await readdir(mapsRoot)).toEqual([]);
    await expect(removeInstalledMap(mapsRoot, '../profile')).rejects.toThrow(/map id/);
  });

  it('maps a /maps/ request onto the map folder and nothing else', () => {
    expect(installedMapPath('/maps/cn-a.json')).toBe('/cn-a/cn-a.json');
    expect(installedMapPath('/maps/cn-a.meta.json')).toBe('/cn-a/cn-a.meta.json');
    expect(installedMapPath('/maps/cn-a.png')).toBe('/cn-a/cn-a.png');
    expect(installedMapPath('/maps/cn-a.map.png')).toBeUndefined();
    expect(installedMapPath('/maps/..%2fx.json')).toBeUndefined();
    expect(installedMapPath('/maps/cn-a/cn-a.json')).toBeUndefined();
    expect(installedMapPath('/ir.json')).toBeUndefined();
  });

  it('serves the app root, then the content root, then the installed maps', async () => {
    await writeInstalledMapFile(mapsRoot, parseInstalledMapFileWrite('cn-a', '.json', BYTES));
    await writeInstalledMapFile(mapsRoot, parseInstalledMapFileWrite('shipped', '.json', BYTES));
    expect(await servedFile(roots, mapsRoot, '/index.html')).toBe(join(roots.appRoot, 'index.html'));
    const shipped = await servedFile(roots, mapsRoot, '/maps/shipped.json');
    expect(shipped === undefined ? null : await readFile(shipped, 'utf8')).toBe('content');
    expect(await servedFile(roots, mapsRoot, '/maps/cn-a.json')).toBe(join(mapsRoot, 'cn-a', 'cn-a.json'));
    expect(await servedFile(roots, mapsRoot, '/maps/cn-b.json')).toBeUndefined();
  });
});
