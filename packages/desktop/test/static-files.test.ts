import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileUnderRoot, servedFile } from '../src/static-files.js';

/** The boundary between a crafted `app://` path and the rest of the user's disk. */
describe('fileUnderRoot', () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'opennorthland-static-'));
    root = join(tmp, 'root');
    await mkdir(join(root, 'maps'), { recursive: true });
    await writeFile(join(root, 'maps', 'two words.json'), '{}');
    await writeFile(join(root, 'index.html'), '<!doctype html>');
    await writeFile(join(tmp, 'outside.txt'), 'x');
    await mkdir(`${root}-evil`, { recursive: true });
    await writeFile(join(`${root}-evil`, 'x.txt'), 'x');
  });

  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('resolves an existing file, percent-decoding the pathname and tolerating repeated slashes', async () => {
    const expected = join(root, 'maps', 'two words.json');
    expect(await fileUnderRoot(root, '/maps/two%20words.json')).toBe(expected);
    expect(await fileUnderRoot(root, '///maps/two words.json')).toBe(expected);
    expect(await fileUnderRoot(root, '/maps/../maps/two words.json')).toBe(expected);
  });

  it('rejects traversal out of the root even when the target exists', async () => {
    expect(await fileUnderRoot(root, '/../outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/../../outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/%2e%2e/outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/../root-evil/x.txt')).toBeUndefined();
  });

  it('rejects directories, absent files and malformed percent sequences', async () => {
    expect(await fileUnderRoot(root, '/')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/missing.json')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/%zz.json')).toBeUndefined();
  });
});

describe('servedFile', () => {
  const HASH = 'a'.repeat(64);
  let tmp: string;
  let appRoot: string;
  let contentRoot: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'opennorthland-served-'));
    appRoot = join(tmp, 'app');
    contentRoot = join(tmp, 'content');
    await mkdir(appRoot, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
    await writeFile(join(appRoot, 'index.html'), '<!doctype html>');
    await writeFile(join(contentRoot, 'ir.json'), '{}');
  });

  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('serves content at its bare path and under any build hash', async () => {
    const roots = { appRoot, contentRoot };
    expect(await servedFile(roots, '/ir.json')).toBe(join(contentRoot, 'ir.json'));
    expect(await servedFile(roots, `/c/${HASH}/ir.json`)).toBe(join(contentRoot, 'ir.json'));
  });

  it('keeps the app out of the versioned prefix', async () => {
    const roots = { appRoot, contentRoot };
    expect(await servedFile(roots, '/index.html')).toBe(join(appRoot, 'index.html'));
    expect(await servedFile(roots, `/c/${HASH}/index.html`)).toBeUndefined();
    expect(await servedFile(roots, `/c/${HASH}/../app/index.html`)).toBeUndefined();
  });
});
