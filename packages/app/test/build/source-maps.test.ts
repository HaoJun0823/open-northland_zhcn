import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { moveSourceMaps, sourceMapFiles } from '../../build/source-maps.js';

let root: string | null = null;
afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});

it('moves every map out of the shipped output and replaces the previous build’s maps', () => {
  root = mkdtempSync(join(tmpdir(), 'on-source-maps-'));
  const dist = join(root, 'dist');
  const maps = join(root, 'dist-sourcemaps');
  mkdirSync(join(dist, 'assets/nested'), { recursive: true });
  writeFileSync(join(dist, 'assets/index-a1.js'), 'code');
  writeFileSync(join(dist, 'assets/index-a1.js.map'), '{}');
  writeFileSync(join(dist, 'assets/nested/sim-worker-b2.js.map'), '{}');
  mkdirSync(join(maps, 'assets'), { recursive: true });
  writeFileSync(join(maps, 'assets/stale-c3.js.map'), '{}');

  const build = { version: '1.2.3', client: 'f'.repeat(64), content: null };
  expect(moveSourceMaps(dist, maps, build)).toBe(2);

  expect(sourceMapFiles(dist)).toEqual([]);
  expect(existsSync(join(dist, 'assets/index-a1.js'))).toBe(true);
  expect(sourceMapFiles(maps).sort()).toEqual([
    join('assets', 'index-a1.js.map'),
    join('assets', 'nested', 'sim-worker-b2.js.map'),
  ]);
  expect(JSON.parse(readFileSync(join(maps, 'build.json'), 'utf8'))).toEqual(build);
});
