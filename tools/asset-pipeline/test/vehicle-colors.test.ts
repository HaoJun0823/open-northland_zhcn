import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PaletteAlias } from '@open-northland/formats/ini';
import { decodePng } from '@open-northland/formats/png';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleBmdBytes } from '../../../packages/formats/test/fixtures/bmd.js';
import { solidPalette } from '../../../packages/formats/test/fixtures/palette.js';
import { samplePcx } from '../../../packages/formats/test/fixtures/pcx.js';
import { BOBS_DIR, BobAtlasCatalog } from '../src/stages/content-tree.js';
import { indexSourceAssets } from '../src/stages/source-files.js';
import { convertVehiclePaletteFamilies, paletteFamilyLutFile } from '../src/stages/vehicle-colors.js';
import { makeTempDir } from './support/game-tree.js';
import { readServedManifest } from './support/served-atlas.js';

const SHIP_BMD = 'data/bobs/ship.bmd';
const CART_BMD = 'data/bobs/cart.bmd';
const FAMILY = ['ship01', 'ship02', 'ship03'];
const FAMILY_REDS = [10, 20, 30];
const PALETTE_ENTRIES = 256;

const paletteFile = (name: string): string => `data/palettes/${name}.pcx`;

const tempCleanups: Array<() => Promise<void>> = [];

async function sourceTree(familyOnDisk: readonly string[]): Promise<string> {
  const { path, cleanup } = await makeTempDir('vehicle-colors');
  tempCleanups.push(cleanup);
  const put = async (rel: string, bytes: Uint8Array): Promise<void> => {
    await mkdir(dirname(join(path, rel)), { recursive: true });
    await writeFile(join(path, rel), bytes);
  };
  await put(SHIP_BMD, sampleBmdBytes());
  await put(CART_BMD, sampleBmdBytes());
  for (const [i, name] of familyOnDisk.entries()) {
    await put(paletteFile(name), samplePcx(solidPalette(FAMILY_REDS[i] ?? 0, 0, 0)).bytes);
  }
  await put(paletteFile('goods'), samplePcx().bytes);
  return path;
}

const aliases: PaletteAlias[] = [...FAMILY, 'goods'].map((name) => ({ name, gfxFile: paletteFile(name) }));

describe('convertVehiclePaletteFamilies', () => {
  afterEach(async () => {
    await Promise.all(tempCleanups.splice(0).map((c) => c()));
  });

  it('emits the indexed body and a row-per-member LUT for a body whose palette starts a family', async () => {
    const out = await sourceTree(FAMILY);
    const atlases = new BobAtlasCatalog(out);
    const result = await convertVehiclePaletteFamilies(
      [
        { bmd: SHIP_BMD, paletteName: 'ship01' },
        { bmd: CART_BMD, paletteName: 'goods' },
      ],
      aliases,
      atlases,
      await indexSourceAssets({ data: out }),
    );

    expect(result.luts).toEqual([paletteFamilyLutFile('ship01')]);
    const { image } = await readServedManifest(atlases, 'ship.indexed');
    expect(result.indexed).toEqual([`${BOBS_DIR}/${image}`]);
    const lut = await decodePng(await readFile(join(out, paletteFamilyLutFile('ship01'))));
    expect([lut.width, lut.height]).toEqual([PALETTE_ENTRIES, FAMILY.length]);
    const rowReds = FAMILY.map((_, row) => lut.rgba[row * PALETTE_ENTRIES * 4]);
    expect(rowReds).toEqual(FAMILY_REDS);
  });

  it('skips a family with an unreadable member, leaving its body to the baked atlas', async () => {
    const out = await sourceTree(FAMILY.slice(0, 2));
    const result = await convertVehiclePaletteFamilies(
      [{ bmd: SHIP_BMD, paletteName: 'ship01' }],
      aliases,
      new BobAtlasCatalog(out),
      await indexSourceAssets({ data: out }),
    );
    expect(result).toEqual({ indexed: [], luts: [] });
  });
});
