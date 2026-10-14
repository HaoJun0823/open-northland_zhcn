import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStringCif, sampleMapLines } from '../../../packages/formats/test/fixtures/cif.js';
import { decodeMapTree, mapCifToInfo } from '../src/stages/maps/index.js';
import { makeTempDir } from './support/game-tree.js';

const PROVENANCE = { kind: 'mod', folder: 'maps/community/tutorial_002' } as const;

describe('mapCifToInfo', () => {
  it('decodes a synthetic map.cif logic header into a validated MapInfo', () => {
    const info = mapCifToInfo(
      buildStringCif(sampleMapLines()),
      'tutorial_002',
      { file: 'maps/community/tutorial_002/map.cif' },
      PROVENANCE,
    );
    expect(info).toMatchObject({ id: 'tutorial_002', width: 142, height: 146, mapType: 1 });
    expect(info.guid).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(info.campaign).toEqual({ campaignId: 100, missionId: 2 });
  });

  it('throws on a .cif whose root is not a CStringArray (not a map)', () => {
    // A truncated/garbage buffer: the CStringArray id check in decodeCifStringArray rejects it.
    expect(() =>
      mapCifToInfo(Uint8Array.from([1, 2, 3, 4, 0, 0, 0, 0]), 'x', { file: 'x' }, PROVENANCE),
    ).toThrow();
  });
});

describe('decodeMapTree', () => {
  let root: string;
  let game: string;

  beforeEach(async () => {
    root = (await makeTempDir('maps')).path;
    game = join(root, 'game');
    await mkdir(join(game, 'maps/community', 'tutorial_002'), { recursive: true });
    await mkdir(join(game, 'maps/community', 'forteca'), { recursive: true });
    await writeFile(
      join(game, 'maps/community', 'tutorial_002', 'map.cif'),
      buildStringCif(sampleMapLines()),
    );
    await writeFile(
      join(game, 'maps/community', 'forteca', 'map.cif'),
      buildStringCif([
        { level: 1, text: 'logiccontrol' },
        { level: 2, text: 'mapsize 250 250' },
        { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
        { level: 1, text: 'misc_maptype' },
        { level: 2, text: 'maptype 4' },
      ]),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('decodes every map.cif under the tree, sorted by relative path, id from folder', async () => {
    const maps = await decodeMapTree({ data: game });
    expect(maps.map((m) => m.id)).toEqual(['forteca', 'tutorial_002']); // sorted by rel path
    expect(maps.find((m) => m.id === 'tutorial_002')).toMatchObject({ width: 142, height: 146, mapType: 1 });
    expect(maps.find((m) => m.id === 'forteca')?.campaign).toBeUndefined();
  });

  it('skips a stray map.cif in the text/ string-table subfolder of a map folder', async () => {
    await mkdir(join(game, 'maps/community', 'forteca', 'text'), { recursive: true });
    await writeFile(
      join(game, 'maps/community', 'forteca', 'text', 'map.cif'),
      buildStringCif(sampleMapLines()),
    );
    const maps = await decodeMapTree({ data: game });
    expect(maps.map((m) => m.id)).toEqual(['forteca', 'tutorial_002']); // no ghost `text` entry
  });

  it('skips a malformed map.cif with a warning instead of aborting the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(game, 'maps/community', 'forteca', 'map.cif'), Uint8Array.from([0, 1, 2, 3]));
    const maps = await decodeMapTree({ data: game });
    expect(maps.map((m) => m.id)).toEqual(['tutorial_002']); // the good one still decodes
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped map.*forteca/));
    warn.mockRestore();
  });
});
