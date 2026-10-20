import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CATALOG_DIR, auditHanCoverage, HAN_FONT, HAN_FONT_SUBSET_SCRIPT } from '../src/audit.js';
import { woff2CodePoints } from '../src/font-coverage.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('woff2CodePoints', () => {
  it('reads the cmap of the bundled Han subset', async () => {
    const covered = await woff2CodePoints(join(REPO_ROOT, HAN_FONT));
    // GB 2312, Big5 level 2, CJK punctuation, the katakana middle dot and a full-width form.
    for (const codePoint of [0x4e00, 0x5a6d, 0x3002, 0x30fb, 0xff01])
      expect(covered.has(codePoint)).toBe(true);
    // Latin and Hangul stay with other faces; U+30A2 is katakana the subset leaves out.
    for (const codePoint of [0x41, 0xac00, 0x30a2]) expect(covered.has(codePoint)).toBe(false);
  });

  it('refuses a file that is not WOFF2', async () => {
    await expect(woff2CodePoints(join(REPO_ROOT, 'package.json'))).rejects.toThrow('not a WOFF2 file');
  });
});

describe('auditHanCoverage', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'han-coverage-'));
    await mkdir(join(repo, APP_CATALOG_DIR), { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function put(rel: string, text: string): Promise<void> {
    await mkdir(dirname(join(repo, rel)), { recursive: true });
    await writeFile(join(repo, rel), text);
  }

  const covered: ReadonlySet<number> = new Set([0x6728, 0x5934]); // 木 头

  it('names each Han code point the font lacks once, with the first file using it', async () => {
    await put('translations/chs/maps/a.json', JSON.stringify({ strings: { '0': '木头 婭' } }));
    await put(
      'translations/cht/maps/b.json',
      JSON.stringify({ strings: { '0': '婭' }, briefings: { x: '饋' } }),
    );
    await put(`${APP_CATALOG_DIR}/cht-game.ts`, "export const g = { title: '覷' };");
    const findings = await auditHanCoverage(repo, covered);
    expect(findings).toEqual([
      {
        file: 'translations/chs/maps/a.json',
        message: `U+5A6D 婭 is missing from ${HAN_FONT}; rerun ${HAN_FONT_SUBSET_SCRIPT}`,
      },
      { file: `${APP_CATALOG_DIR}/cht-game.ts`, message: expect.stringContaining('U+89B7 覷') },
      { file: 'translations/cht/maps/b.json', message: expect.stringContaining('U+994B 饋') },
    ]);
  });

  it('ignores non-Han text, other catalogs, JSON keys and files that do not parse', async () => {
    await put('translations/eng/maps/a.json', JSON.stringify({ strings: { 婭: 'Fjord' } }));
    await put('translations/chs/maps/broken.json', '{ "strings": "饋');
    await put('translations/AGENTS.md', '饋');
    await put(`${APP_CATALOG_DIR}/en-game.ts`, "export const g = { title: '覷' };");
    await put(`${APP_CATALOG_DIR}/chs-game.ts`, "export const g = { title: 'Wood 木头' };");
    expect(await auditHanCoverage(repo, covered)).toEqual([]);
  });
});
