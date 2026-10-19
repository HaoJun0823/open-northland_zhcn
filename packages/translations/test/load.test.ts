import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { OVERLAY_VERSION } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTranslationOverlays, TRANSLATIONS_ROOT } from '../src/load.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const BASIS = { lang: 'pol', digest: 'c'.repeat(64) } as const;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'translations-load-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, value: unknown): Promise<void> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
}

function mapOverlay(strings: Record<string, string>) {
  return { version: OVERLAY_VERSION, map: 'wyprawa', basis: BASIS, strings };
}

describe('loadTranslationOverlays', () => {
  it('keys map overlays by digest across languages, and the rest by language then file id', async () => {
    await put(`chs/maps/${DIGEST_A}.json`, mapOverlay({ '0': '北行' }));
    await put(`cht/maps/${DIGEST_A}.json`, mapOverlay({ '0': '北行' }));
    await put(`eng/maps/${DIGEST_B}.json`, mapOverlay({ '0': 'Voyage' }));
    await put('chs/objects/goods.json', { version: OVERLAY_VERSION, basis: BASIS, names: { '1': '木头' } });
    await put('chs/books/history.json', {
      version: OVERLAY_VERSION,
      basis: BASIS,
      blocks: { 'history.txt': { '00': '历史' } },
    });
    await put('cht/campaigns/saga.json', { version: OVERLAY_VERSION, title: '傳奇' });

    const overlays = await loadTranslationOverlays(root);

    expect([...overlays.maps.keys()].sort()).toEqual([DIGEST_A, DIGEST_B]);
    expect([...(overlays.maps.get(DIGEST_A)?.keys() ?? [])]).toEqual(['chs', 'cht']);
    expect(overlays.maps.get(DIGEST_B)?.get('eng')?.strings).toEqual({ '0': 'Voyage' });
    expect(overlays.maps.get(DIGEST_A)?.get('chs')?.briefings).toEqual({});
    expect(overlays.objects.get('chs')?.get('goods')).toMatchObject({ names: { '1': '木头' }, plurals: {} });
    expect(overlays.books.get('chs')?.get('history')?.blocks).toEqual({ 'history.txt': { '00': '历史' } });
    expect(overlays.campaigns.get('cht')?.get('saga')?.title).toBe('傳奇');
    expect(overlays.objects.has('cht')).toBe(false);
  });

  it('reads only known languages, kinds and JSON files', async () => {
    await put(`xyz/maps/${DIGEST_A}.json`, mapOverlay({}));
    await put('chs/notes/readme.json', { anything: true });
    await put('chs/maps/readme.txt', 'not an overlay');
    await put('SOURCES.md', '# Sources');
    const overlays = await loadTranslationOverlays(root);
    expect(overlays.maps.size).toBe(0);
  });

  it('fails on a malformed file, naming its path and the schema issue', async () => {
    await put(`chs/maps/${DIGEST_A}.json`, {
      ...mapOverlay({}),
      basis: { lang: 'chs', digest: BASIS.digest },
    });
    await expect(loadTranslationOverlays(root)).rejects.toThrow(
      new RegExp(`chs/maps/${DIGEST_A}\\.json: invalid maps overlay at basis\\.lang`),
    );
  });

  it('refuses an id key with leading zeros, which would not name the id it parses to', async () => {
    await put(`chs/maps/${DIGEST_A}.json`, mapOverlay({ '07': '北行' }));
    await expect(loadTranslationOverlays(root)).rejects.toThrow(/invalid maps overlay at strings\.07/);
  });

  it('fails on a file that is not JSON, naming its path', async () => {
    await put('chs/objects/goods.json', '{ not json');
    await expect(loadTranslationOverlays(root)).rejects.toThrow(/chs\/objects\/goods\.json: /);
  });

  it('holds no overlays for a missing root, and resolves the repository folder by default', async () => {
    const overlays = await loadTranslationOverlays(join(root, 'absent'));
    expect([overlays.maps.size, overlays.objects.size, overlays.books.size, overlays.campaigns.size]).toEqual(
      [0, 0, 0, 0],
    );
    expect(TRANSLATIONS_ROOT).toMatch(/[\\/]translations[\\/]$/);
  });
});
