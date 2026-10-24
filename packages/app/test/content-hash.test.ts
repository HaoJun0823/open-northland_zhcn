import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentPrefix, contentTreeHash, unversionedContentPath } from '../build/content-hash.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('contentTreeHash', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opennorthland-content-hash-'));
    await mkdir(join(root, 'maps'));
    await writeFile(join(root, 'ir.json'), '{}');
    await writeFile(join(root, 'maps', 'a.json'), 'map');
    await writeFile(join(root, 'maps-index.json'), '[]');
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('hashes the sha256sum manifest of the tree, sorted by path bytes like `LC_ALL=C sort`', async () => {
    // `./maps-index.json` sorts before `./maps/a.json`: '-' is 0x2d, '/' is 0x2f.
    const manifest = [
      `${sha256('{}')}  ./ir.json\n`,
      `${sha256('[]')}  ./maps-index.json\n`,
      `${sha256('map')}  ./maps/a.json\n`,
    ].join('');
    expect(await contentTreeHash(root)).toBe(sha256(manifest));
  });

  it('changes with any file byte and is null without a tree', async () => {
    const before = await contentTreeHash(root);
    await writeFile(join(root, 'maps', 'a.json'), 'map!');
    expect(await contentTreeHash(root)).not.toBe(before);
    expect(await contentTreeHash(join(root, 'missing'))).toBeNull();
  });

  it('refuses a symlink, which a server would follow without its bytes in the hash', async () => {
    await symlink(join(root, 'ir.json'), join(root, 'maps', 'linked.json'));
    await expect(contentTreeHash(root)).rejects.toThrow('content must not hold a symlink: maps/linked.json');
  });
});

describe('unversionedContentPath', () => {
  const HASH = 'f'.repeat(64);

  it('names the content path under a build prefix and leaves other paths alone', () => {
    expect(unversionedContentPath(`${contentPrefix(HASH)}/bobs/x.png`)).toBe('/bobs/x.png');
    expect(unversionedContentPath('/bobs/x.png')).toBe('/bobs/x.png');
    expect(unversionedContentPath('/c/short/bobs/x.png')).toBe('/c/short/bobs/x.png');
  });
});

/** Servers outside the app's package boundary keep their own copy of the versioned path pattern. */
const VERSIONED_PATH_COPIES = [
  'packages/desktop/src/protocol/static-files.ts',
  'scripts/boot-check/static-server.mjs',
];
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The `VERSIONED_CONTENT_PATH` literal a copy declares, capturing the content path as group 1. */
function versionedPathCopy(file: string): RegExp {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  const literal = /const VERSIONED_CONTENT_PATH = \/(.+)\/;/.exec(source)?.[1];
  if (literal === undefined) throw new Error(`${file} declares no VERSIONED_CONTENT_PATH literal`);
  return new RegExp(literal);
}

describe('versioned content path copies', () => {
  const hash = sha256('tree');
  const paths = [
    `/c/${hash}/ir.json`,
    `/c/${hash}/bobs/a.webp`,
    `/c/${hash.slice(1)}/ir.json`,
    `/c/${hash.toUpperCase()}/ir.json`,
    `/c/${hash}`,
    `/x/${hash}/ir.json`,
    '/ir.json',
  ];

  it.each(VERSIONED_PATH_COPIES)('%s names the same content path as the app', (file) => {
    const copy = versionedPathCopy(file);
    for (const path of paths) expect(copy.exec(path)?.[1] ?? path).toBe(unversionedContentPath(path));
  });
});
