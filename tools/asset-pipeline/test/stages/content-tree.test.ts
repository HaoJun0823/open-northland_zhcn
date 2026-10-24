import { join } from 'node:path';
import { ATLAS_PALETTE_BYTES, type BobAtlas } from '@open-northland/formats/atlas/index';
import type { RgbaImage } from '@open-northland/formats/image';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDistinctBobBasenames, BobAtlasCatalog, bobAtlasStem } from '../../src/stages/content-tree.js';
import { makeTempDir } from '../support/game-tree.js';

describe('bobAtlasStem', () => {
  it('drops the source directory and casing - the app addresses atlases by basename alone', () => {
    expect(bobAtlasStem(join('Data', 'engine2d', 'bin', 'bobs', 'ls_trees.bmd'), 'tree_yew01')).toBe(
      'ls_trees.tree_yew01',
    );
    expect(bobAtlasStem('data/engine2d/bin/bobs/nowe/f_bakery.bmd', 'ship_house')).toBe(
      'f_bakery.ship_house',
    );
    expect(bobAtlasStem(join('Data', 'Bobs', 'Body_S.BMD'), 'shadow')).toBe('body_s.shadow');
  });
});

describe('assertDistinctBobBasenames', () => {
  it('accepts repeated refs and distinct basenames across subdirectories', () => {
    expect(() =>
      assertDistinctBobBasenames([
        'data/engine2d/bin/bobs/mur.bmd',
        'data/engine2d/bin/bobs/nowe/f_bakery.bmd',
        'data/engine2d/bin/bobs/mur.bmd',
      ]),
    ).not.toThrow();
  });

  it('reports every colliding pair in one throw - a rerun costs a full conversion', () => {
    expect(() =>
      assertDistinctBobBasenames([
        'data/engine2d/bin/bobs/mur.bmd',
        'data/engine2d/bin/bobs/nowe/mur.bmd',
        'data/engine2d/bin/bobs/f_bakery.bmd',
        'data/engine2d/bin/bobs/test/f_bakery.bmd',
      ]),
    ).toThrow(/nowe\/mur\.bmd.*mur\.<suffix>.*test\/f_bakery\.bmd.*f_bakery\.<suffix>/s);
  });
});

describe('BobAtlasCatalog sheet sharing', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((c) => c()));
  });

  async function catalog(): Promise<BobAtlasCatalog> {
    const { path, cleanup } = await makeTempDir('atlas-catalog');
    cleanups.push(cleanup);
    return new BobAtlasCatalog(path);
  }

  const OPAQUE = 255;
  const sheet = (red: number): RgbaImage => ({ width: 1, height: 1, rgba: Uint8Array.of(red, 0, 0, OPAQUE) });
  const atlas = (offsetX = 0, timeImage?: RgbaImage): BobAtlas => ({
    image: sheet(1),
    manifest: {
      width: 1,
      height: 1,
      frames: [
        { bobId: 0, type: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, offsetX, offsetY: 0, opaque: true },
      ],
    },
    ...(timeImage === undefined ? {} : { timeImage }),
  });

  it('serves stems that share a sheet in one layout and one time sheet', async () => {
    const atlases = await catalog();
    await atlases.writeAtlas('a.red', atlas(0, sheet(2)));
    await atlases.writeAtlas('b.red', atlas(0, sheet(2)));
    // Another geometry cuts its own frames, so its reveal may differ.
    await atlases.writeAtlas('c.red', atlas(1));
    await atlases.writeAtlas('d.indexed', { indexed: atlas(), palette: new Uint8Array(ATLAS_PALETTE_BYTES) });
    await atlases.writeAtlas('e.indexed', { indexed: atlas(), palette: new Uint8Array(ATLAS_PALETTE_BYTES) });
    expect(Object.keys(atlases.document().stems)).toHaveLength(5);
  });

  it('refuses one sheet loaded in two layouts, naming both stems', async () => {
    const atlases = await catalog();
    await atlases.writeAtlas('body.red', atlas());
    await atlases.writeAtlas('body.indexed', atlas());
    await atlases.writeAtlas('wave.indexed', atlas(), 'displacement');
    expect(() => atlases.document()).toThrow(
      /body\.red \(rgba\) and body\.indexed \(indexed\).*body\.red \(rgba\) and wave\.indexed \(displacement\)/s,
    );
  });

  it('refuses stems cutting one RGB sheet alike under different time sheets', async () => {
    const atlases = await catalog();
    await atlases.writeAtlas('house.a', atlas(0, sheet(2)));
    await atlases.writeAtlas('house.b', atlas(0, sheet(3)));
    expect(() => atlases.document()).toThrow(/house\.a and house\.b share the frames of .* time sheet/);
  });
});
