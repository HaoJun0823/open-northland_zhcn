import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encodeMapDat,
  encodeMapSize,
  packMapLayer,
  packX6elLayer,
} from '@open-northland/formats/mapdat/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeStringList } from '../../../packages/formats/test/fixtures/mapdat.js';
import { loadSourceCorrections } from '../src/corrections.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

const FILE = 'maps/community/sample/map.dat';
const EMPTY_OBJECT = 0xffff;
const NEUTRAL = 0xff;

interface Placement {
  readonly hx: number;
  readonly hy: number;
  readonly name: number;
  readonly level: number;
  readonly owner: number;
}

/** An authored `width × height` map whose object lanes hold `placements` over the `names` dictionary. */
function objectMap(
  width: number,
  height: number,
  names: readonly string[],
  placements: readonly Placement[],
  lanes: { readonly owners: boolean } = { owners: true },
): Uint8Array {
  const hw = width * 2;
  const halfCells = hw * height * 2;
  const emla = new Uint16Array(halfCells).fill(EMPTY_OBJECT);
  const lmlv = new Uint8Array(halfCells);
  const lmlp = new Uint8Array(halfCells).fill(NEUTRAL);
  for (const { hx, hy, name, level, owner } of placements) {
    emla[hy * hw + hx] = name;
    lmlv[hy * hw + hx] = level;
    lmlp[hy * hw + hx] = owner;
  }
  return encodeMapDat([
    { tag: 'lsiz', version: 1, payload: encodeMapSize({ width, height }) },
    { tag: 'lmlt', version: 1, payload: packMapLayer(new Uint8Array(halfCells).fill(2)) },
    { tag: 'emla', version: 1, payload: packX6elLayer(emla) },
    { tag: 'lmlv', version: 1, payload: packMapLayer(lmlv) },
    ...(lanes.owners ? [{ tag: 'lmlp', version: 1, payload: packMapLayer(lmlp) }] : []),
    { tag: 'eald', version: 1, payload: encodeStringList(names) },
  ]);
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// wall_02 at (1,0) and (1,2) of player 5, a neutral palm at (3,3); (1,1) is the gap.
const NAMES = ['wall_02', 'palm 01'];
const SAMPLE = objectMap(2, 2, NAMES, [
  { hx: 1, hy: 0, name: 0, level: 100, owner: 5 },
  { hx: 1, hy: 2, name: 0, level: 100, owner: 5 },
  { hx: 3, hy: 3, name: 1, level: 3, owner: NEUTRAL },
]);
const WALL = { type: 'wall_02', level: 100, owner: 5 };
const FILL = { hx: 1, hy: 1, from: null, to: WALL };

describe('map.dat object corrections', () => {
  let temp: TempDir;
  let data: string;
  let dir: string;
  const load = async (extra: object = {}, source = SAMPLE) => {
    await writeFile(join(data, FILE), source);
    const correction = {
      reason: 'synthetic wall gap',
      file: FILE,
      sha256: sha256(source),
      format: 'mapdat',
      objects: [FILL],
      ...extra,
    };
    await writeFile(join(dir, 'gap.json'), JSON.stringify(correction));
    return loadSourceCorrections(dir, data);
  };
  const convert = async (corrections: Awaited<ReturnType<typeof load>>) => {
    await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
    return JSON.parse(await readFile(join(temp.path, 'out/maps/sample.json'), 'utf8')).objects;
  };
  beforeEach(async () => {
    temp = await makeTempDir('mapdat-corrections');
    data = join(temp.path, 'data');
    dir = join(temp.path, 'corrections');
    await mkdir(join(data, 'maps/community/sample'), { recursive: true });
    await mkdir(dir);
  });
  afterEach(() => temp.cleanup());

  it('adds, replaces and removes objects in row-major order without rewriting the source bytes', async () => {
    const corrections = await load({
      objects: [
        FILL,
        { hx: 1, hy: 2, from: WALL, to: { type: 'palm 01', level: 2, owner: null } },
        { hx: 3, hy: 3, from: { type: 'palm 01', level: 3, owner: null }, to: null },
      ],
    });
    expect(Uint8Array.from(await corrections.read(join(data, FILE)))).toEqual(SAMPLE);
    expect(() => corrections.assertApplied()).toThrow(/never read/);
    expect(await convert(corrections)).toEqual({
      types: ['wall_02', 'palm 01'],
      placements: [1, 0, 0, 1, 1, 0, 1, 2, 1],
      levels: [100, 100, 2],
      owners: [5, 5, null],
    });
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it.each([
    { name: 'a changed file', extra: { sha256: '0'.repeat(64) }, why: /file changed/ },
    {
      name: 'an occupied node',
      extra: { objects: [{ ...FILL, hx: 1, hy: 0 }] },
      why: /holds wall_02 level 100 owner 5, not no object/,
    },
    {
      name: 'a different object',
      extra: { objects: [{ hx: 3, hy: 3, from: { ...WALL, owner: null }, to: null }] },
      why: /holds palm 01/,
    },
    {
      name: 'a type the map lacks',
      extra: { objects: [{ ...FILL, to: { ...WALL, type: 'wall_2' } }] },
      why: /places no "wall_2"/,
    },
    { name: 'a node off the map', extra: { objects: [{ ...FILL, hx: 4 }] }, why: /outside the 2x2 map/ },
  ])('refuses $name and fails the run', async ({ extra, why }) => {
    const corrections = await load(extra);
    await expect(convert(corrections)).rejects.toThrow(why);
    expect(() => corrections.assertApplied()).toThrow(why);
  });

  it('refuses a map without the owner lane', async () => {
    const source = objectMap(2, 2, NAMES, [{ hx: 1, hy: 0, name: 0, level: 100, owner: 5 }], {
      owners: false,
    });
    await expect(convert(await load({}, source))).rejects.toThrow(/lacks its lmlv or lmlp lane/);
  });

  it.each([
    { lines: [{ from: 'a', to: 'b' }] },
    { format: undefined },
    { objects: [] },
    { objects: [FILL, FILL] },
    { objects: [{ ...FILL, to: null }] },
    { objects: [{ ...FILL, to: { ...WALL, owner: 16 } }] },
    { objects: [{ ...FILL, to: { ...WALL, colour: 1 } }] },
    { objects: [{ hx: 1, hy: 1, to: WALL }] },
  ])('rejects a malformed object correction: %j', async (extra) => {
    await expect(load(extra)).rejects.toThrow(/correction gap/);
  });
});
