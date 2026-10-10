import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstallCandidate } from '../../src/original-game/candidates.js';
import { detectInstall } from '../../src/original-game/detect.js';
import { writeLibraryInstall } from './fixture.js';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'original-detect-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const steam = (path: string): InstallCandidate => ({ path, source: 'steam' });

describe('detectInstall', () => {
  it('takes the first candidate the rule recognizes', async () => {
    await mkdir(join(root, 'empty'));
    await writeLibraryInstall(join(root, 'game'));
    const found = await detectInstall(undefined, async () => [
      steam(join(root, 'missing')),
      steam(join(root, 'empty')),
      steam(join(root, 'game')),
    ]);
    expect(found?.path).toBe(join(root, 'game'));
    expect(found?.install.layout).toBe('library');
  });

  it('recognizes an install one level below the override', async () => {
    await writeLibraryInstall(join(root, 'library', 'Cultures 8th Wonder'));
    const found = await detectInstall(join(root, 'library'), async () => []);
    expect(found?.path).toBe(join(root, 'library', 'Cultures 8th Wonder'));
  });

  it('never falls back to the search when the override fails', async () => {
    await mkdir(join(root, 'empty'));
    await writeLibraryInstall(join(root, 'game'));
    let searched = false;
    const found = await detectInstall(join(root, 'empty'), async () => {
      searched = true;
      return [steam(join(root, 'game'))];
    });
    expect(found).toBeUndefined();
    expect(searched).toBe(false);
  });
});
