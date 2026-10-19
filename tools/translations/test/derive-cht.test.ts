import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OVERLAY_VERSION } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveTraditionalMaps } from '../src/derive-cht.js';

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

describe('deriveTraditionalMaps', () => {
  it('writes a derived twin for a chs overlay without one and converts every value', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '简体'));
    const result = await deriveTraditionalMaps(root, convert);
    expect(result).toEqual({ written: [`${DIGEST}.json`], kept: [] });
    const twin = await read('cht', `${DIGEST}.json`);
    expect(twin.strings['0']).toBe('簡体');
    expect(twin.briefings.intro).toBe('<picture:a.pcx>\n簡体');
    expect(twin.derived).toBe('chs');
    expect(twin.basis).toEqual(overlay('fjord', '').basis);
  });

  it('rewrites a derived twin but keeps an imported or hand-written one', async () => {
    await write('chs', `${DIGEST}.json`, overlay('fjord', '简'));
    await write('cht', `${DIGEST}.json`, overlay('fjord', 'stale', 'chs'));
    await write('chs', `${OTHER_DIGEST}.json`, overlay('cove', '简'));
    await write('cht', `${OTHER_DIGEST}.json`, overlay('cove', '手写'));
    const result = await deriveTraditionalMaps(root, convert);
    expect(result).toEqual({ written: [`${DIGEST}.json`], kept: [`${OTHER_DIGEST}.json`] });
    expect((await read('cht', `${DIGEST}.json`)).strings['0']).toBe('簡');
    expect((await read('cht', `${OTHER_DIGEST}.json`)).strings['0']).toBe('手写');
  });
});
