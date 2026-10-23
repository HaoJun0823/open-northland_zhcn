import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  type AtlasAlphaMode,
  type BobAtlas,
  colourIndexedSheet,
  GREY_ALPHA_INDEXED,
  indexedToGreyAlpha,
  type PackBobAtlasOptions,
  packBobAtlas,
  packIndexedBobAtlas,
} from '@open-northland/formats/atlas/index';
import { type Bmd, BOB_TYPE_DOUBLE8BIT, decodeBmd } from '@open-northland/formats/bmd/index';
import { paletteAliasMap } from '@open-northland/formats/ini';
import { decodePcx } from '@open-northland/formats/pcx';
import { decodeGreyAlphaPng } from '@open-northland/formats/png';
import { describe, expect, it } from 'vitest';
import { packLineControl } from '../../../packages/formats/test/fixtures/bmd.js';
import { rampPalette } from '../../../packages/formats/test/fixtures/palette.js';
import { CORRECTIONS_DIR, loadSourceCorrections } from '../src/corrections.js';
import { resolveDataPack } from '../src/roots.js';
import { encodePalettedSheet } from '../src/stages/atlas-image.js';
import { resolveGraphicsBindings } from '../src/stages/bmd/index.js';
import { indexSourceAssets } from '../src/stages/source-files.js';

/** Expects the indexed atlas coloured through `palette` to be the RGB atlas, byte for byte. */
function expectColouredTwin(bmd: Bmd, palette: Uint8Array, options: PackBobAtlasOptions, label = ''): void {
  const rgb: BobAtlas = packBobAtlas(bmd, palette, options);
  const indexed = packIndexedBobAtlas(bmd, options);
  const coloured = new Uint8Array(indexed.image.rgba.length);
  colourIndexedSheet(indexedToGreyAlpha(indexed.image).pixels, GREY_ALPHA_INDEXED, palette, coloured);
  expect(indexed.manifest, label).toEqual(rgb.manifest);
  expect(Buffer.from(coloured).equals(Buffer.from(rgb.image.rgba)), label).toBe(true);
  expect(indexed.timeImage === undefined, label).toBe(rgb.timeImage === undefined);
  if (indexed.timeImage !== undefined && rgb.timeImage !== undefined) {
    expect(Buffer.from(indexed.timeImage.rgba).equals(Buffer.from(rgb.timeImage.rgba)), label).toBe(true);
  }
}

describe('packIndexedBobAtlas coloured through a palette', () => {
  // Two type-4 bobs, each a 2x1 run of [index, second] pairs: a graded pixel and an opaque one.
  const pairs = [0x02, 4, 0x60, 8, 0xff, 0x00];
  const bmd: Bmd = {
    version: 0,
    firstBobId: 10,
    bobCount: 2,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: [
      { type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 },
      { type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 1 },
    ],
    packedLineData: Uint8Array.from([...pairs, ...pairs]),
    lineControl: Uint32Array.from([packLineControl(0, 0), packLineControl(0, pairs.length)]),
  };

  it.each<[string, PackBobAtlasOptions]>([
    ['per-pixel coverage', { alpha: 'per-pixel' }],
    ['build-time thresholds', { alpha: 'build-time' }],
    ['build-time with a coverage decor bob', { alpha: 'build-time', coverageBobs: new Set([11]) }],
  ])('is the RGB atlas for %s', (_, options) => {
    expectColouredTwin(bmd, rampPalette(), options);
  });

  it('keeps every index and coverage through the served PNG', async () => {
    const indexed = packIndexedBobAtlas(bmd, { alpha: 'per-pixel' });
    const served = await decodeGreyAlphaPng(await encodePalettedSheet(indexed.image));
    expect(served.pixels).toEqual(indexedToGreyAlpha(indexed.image).pixels);
  });
});

/** The unpacked data pack the real-content check reads; it runs only when `ON_DATA_ROOT` names one. */
const dataRoot = process.env.ON_DATA_ROOT;

describe.runIf(dataRoot !== undefined && existsSync(dataRoot))('every pack binding coloured at load', () => {
  it('equals the RGB atlas the bob set bakes through the binding palette', async () => {
    const data = (await resolveDataPack(dataRoot ?? '')).base;
    const roots = { data, corrections: await loadSourceCorrections(CORRECTIONS_DIR, data) };
    const { bindings, palettes, buildTimeBmds, coverageBobs } = await resolveGraphicsBindings(roots);
    const tree = await indexSourceAssets(roots);
    const pcxByName = paletteAliasMap(palettes);
    const paletteNamesByBmd = new Map<string, Set<string>>();
    for (const { bmd, paletteName } of bindings) {
      if (!tree.has(bmd) || !pcxByName.has(paletteName)) continue;
      paletteNamesByBmd.set(bmd, (paletteNamesByBmd.get(bmd) ?? new Set()).add(paletteName));
    }
    let checked = 0;
    for (const [bmdRef, names] of paletteNamesByBmd) {
      const source = tree.get(bmdRef);
      if (source === undefined) continue;
      const bmd = decodeBmd(await readFile(source.path));
      const alpha: AtlasAlphaMode = buildTimeBmds.has(bmdRef) ? 'build-time' : 'per-pixel';
      const coverage = coverageBobs.get(bmdRef);
      const options = { alpha, ...(coverage === undefined ? {} : { coverageBobs: coverage }) };
      for (const name of names) {
        const pcx = tree.get(pcxByName.get(name) ?? '');
        const palette = pcx === undefined ? undefined : decodePcx(await readFile(pcx.path)).palette;
        if (palette === undefined) continue;
        expectColouredTwin(bmd, palette, options, `${bmdRef} through ${name}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 1_800_000);
});
