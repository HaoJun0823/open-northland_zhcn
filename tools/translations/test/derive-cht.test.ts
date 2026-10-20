import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAP_OVERLAY_BASIS_PREFIX_LENGTH, OVERLAY_VERSION } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveTraditionalOverlays } from '../src/derive-cht.js';

/** `npm run translations:derive-cht`: a `cht` twin for each project `chs` map overlay. The converter
 *  here is a stand-in, so the test proves the file rules, not OpenCC. */

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const overlay = (map: string, text: string, derived?: 'chs') => ({
  version: OVERLAY_VERSION,
  map,
  basis: { lang: 'pol', digest: 'c'.repeat(64) },
  strings: { '0': text },
  briefings: { intro: `<picture:a.pcx>\n${text}` },
  ...(derived === undefined ? {} : { derived }),
});
const convert = (text: string): string => text.replaceAll('简', '簡');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'derive-cht-'));
  await mkdir(join(root, 'chs', 'maps'), { recursive: true });
  await mkdir(join(root, 'cht', 'maps'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = (lang: string, name: string, value: unknown): Promise<void> =>
  writeFile(join(root, lang, 'maps', name), JSON.stringify(value));
const read = async (lang: string, name: string): Promise<ReturnType<typeof overlay>> =>
  JSON.parse(await readFile(join(root, lang, 'maps', name), 'utf8'));

describe('deriveTraditionalOverlays', () => {
  it('derives an object table edit and keeps an imported object table', async () => {
    await mkdir(join(root, 'chs', 'objects'), { recursive: true });
    await mkdir(join(root, 'cht', 'objects'), { recursive: true });
    const table = (names: Record<string, string>, derived?: string) => ({
      version: OVERLAY_VERSION,
      basis: { lang: 'pol', digest: 'c'.repeat(64) },
      names,
      ...(derived === undefined ? {} : { derived }),
    });
    await writeFile(join(root, 'chs', 'objects', 'goods.json'), JSON.stringify(table({ '1': '简' })));
    await writeFile(join(root, 'cht', 'objects', 'goods.json'), JSON.stringify(table({ '1': '手写' })));
    await writeFile(join(root, 'chs', 'objects', 'goods.edit.json'), JSON.stringify(table({ '2': '简' })));

    const result = await deriveTraditionalOverlays(root, convert);

    expect(result).toEqual({
      written: ['objects/goods.edit.json'],
      kept: ['objects/goods.json'],
      deleted: [],
      unreadable: [],
    });
    expect(JSON.parse(await readFile(join(root, 'cht', 'objects', 'goods.edit.json'), 'utf8'))).toEqual({
      ...table({ '2': '簡' }, 'chs'),
      plurals: {},
    });
  });

  it('writes a derived twin for a chs overlay without one and converts every value', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '简体'));
    const result = await deriveTraditionalOverlays(root, convert);
    expect(result).toEqual({ written: [`maps/${DIGEST}.json`], kept: [], deleted: [], unreadable: [] });
    const twin = await read('cht', `${DIGEST}.json`);
    expect(twin.strings['0']).toBe('簡体');
    expect(twin.briefings.intro).toBe('<picture:a.pcx>\n簡体');
    expect(twin.derived).toBe('chs');
    expect(twin.basis).toEqual(overlay('fjord', '').basis);
  });

  it('turns mainland quotation marks into corner brackets', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '他说：“走吧，‘现在’就走。”'));
    await deriveTraditionalOverlays(root, convert);
    expect((await read('cht', `${DIGEST}.json`)).strings['0']).toBe('他说：「走吧，『现在』就走。」');
  });

  it('rewrites a derived twin but keeps an imported or hand-written one', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '简'));
    await write('cht', `${DIGEST}.json`, overlay('fjord', 'stale', 'chs'));
    await write('chs', `${OTHER_DIGEST}.json`, overlay('cove', '简'));
    await write('cht', `${OTHER_DIGEST}.json`, overlay('cove', '手写'));
    const result = await deriveTraditionalOverlays(root, convert);
    expect(result).toEqual({
      written: [`maps/${DIGEST}.json`],
      kept: [`maps/${OTHER_DIGEST}.json`],
      deleted: [],
      unreadable: [],
    });
    expect((await read('cht', `${DIGEST}.json`)).strings['0']).toBe('簡');
    expect((await read('cht', `${OTHER_DIGEST}.json`)).strings['0']).toBe('手写');
  });

  it('deletes a derived twin whose chs file is gone or renamed to a variant, and keeps others', async () => {
    const variant = `${DIGEST}.${'c'.repeat(MAP_OVERLAY_BASIS_PREFIX_LENGTH)}.json`;
    await write('chs', variant, overlay('fjord', '简'));
    await write('cht', `${DIGEST}.json`, overlay('fjord', '舊', 'chs'));
    await write('cht', `${OTHER_DIGEST}.json`, overlay('cove', '手写'));
    const result = await deriveTraditionalOverlays(root, convert);
    expect(result).toEqual({
      written: [`maps/${variant}`],
      kept: [],
      deleted: [`maps/${DIGEST}.json`],
      unreadable: [],
    });
    expect((await readdir(join(root, 'cht', 'maps'))).sort()).toEqual([variant, `${OTHER_DIGEST}.json`]);
  });

  it('reports a file that does not read as an overlay and leaves it and its twin alone', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '简'));
    await write('cht', `${DIGEST}.json`, { broken: true });
    await write('chs', `${OTHER_DIGEST}.json`, { version: OVERLAY_VERSION });
    await write('cht', `${OTHER_DIGEST}.json`, overlay('cove', '舊', 'chs'));
    const result = await deriveTraditionalOverlays(root, convert);
    expect(result).toMatchObject({ written: [], kept: [], deleted: [] });
    expect(result.unreadable.map(({ file }) => file)).toEqual([
      `cht/maps/${DIGEST}.json`,
      `chs/maps/${OTHER_DIGEST}.json`,
    ]);
    expect(await read('cht', `${DIGEST}.json`)).toEqual({ broken: true });
    expect((await read('cht', `${OTHER_DIGEST}.json`)).strings['0']).toBe('舊');
  });
});
