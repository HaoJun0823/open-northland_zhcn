import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeCifStringArray } from '@open-northland/formats/cif';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../../packages/formats/test/fixtures/mapdat.js';
import { loadSourceCorrections } from '../../src/corrections.js';
import { convertMapDatTree } from '../../src/stages/maps/index.js';
import { makeTempDir, type TempDir } from '../support/game-tree.js';

const FILE = 'maps/community/sample/map.cif';
const LINES = [
  { level: 1, text: 'MissionData' },
  { level: 2, text: 'debuginfo "lesson"' },
  { level: 2, text: 'goal "BuildHouses" 0 "work pottery 02" 1 0' },
  { level: 1, text: 'StaticObjects' },
  { level: 2, text: 'sethuman 0 "viking" "civilist" 0 0 1 0' },
];
const bytes = buildStringCif(LINES);
const digest = createHash('sha256').update(bytes).digest('hex');
const edit = { line: 3, from: LINES[2]?.text, to: 'goal "GoodsGlobal" 0 "crockery" 1' };

describe('decoded CIF source corrections', () => {
  let temp: TempDir;
  let data: string;
  let dir: string;
  const correction = (extra: object = {}) => ({
    reason: 'synthetic stale lesson',
    file: FILE,
    sha256: digest,
    format: 'cif',
    lines: [edit],
    ...extra,
  });
  const load = async (extra: object = {}) => {
    await writeFile(join(dir, 'lesson.json'), JSON.stringify(correction(extra)));
    return loadSourceCorrections(dir, data);
  };
  beforeEach(async () => {
    temp = await makeTempDir('cif-corrections');
    data = join(temp.path, 'data');
    dir = join(temp.path, 'corrections');
    await mkdir(join(data, 'maps/community/sample'), { recursive: true });
    await mkdir(dir);
    await writeFile(join(data, FILE), bytes);
  });
  afterEach(() => temp.cleanup());

  it('requires decoded application, preserves unrelated lines and never mutates inputs', async () => {
    const corrections = await load({ lines: [{ ...edit, to: [edit.to, 'goal "True"'] }] });
    expect(Uint8Array.from(await corrections.read(join(data, FILE)))).toEqual(bytes);
    expect(() => corrections.assertApplied()).toThrow(/never read/);
    const lines = decodeCifStringArray(bytes).lines;
    const before = structuredClone(lines);
    const changed = corrections.correctCifLines(FILE.toUpperCase(), bytes, lines);
    expect(changed).toEqual([
      ...LINES.slice(0, 2),
      { level: 2, text: edit.to },
      { level: 2, text: 'goal "True"' },
      ...LINES.slice(3),
    ]);
    expect(lines).toEqual(before);
    expect(corrections.correctCifLines('elsewhere/map.cif', bytes, lines)).toBe(lines);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it.each([
    { sha256: '0'.repeat(64) },
    { lines: [{ ...edit, from: 'different property' }] },
    { lines: [{ line: 1, from: 'MissionData', to: 'another header' }] },
    { lines: [edit, edit] },
  ])('refuses mismatched hashes, properties, headers and overlapping edits: %j', async (extra) => {
    const corrections = await load(extra);
    expect(() => corrections.correctCifLines(FILE, bytes, LINES)).toThrow(/correction lesson/);
    expect(LINES[2]?.text).toBe(edit.from);
    expect(() => corrections.assertApplied()).toThrow();
  });

  it.each([{ format: 'other' }, { encoding: 'utf-8' }, { lines: [{ ...edit, line: undefined }] }])(
    'rejects unsupported CIF edit metadata: %j',
    async (extra) => {
      await expect(load(extra)).rejects.toThrow(/correction lesson/);
    },
  );

  it('feeds corrected properties to the real map conversion without rewriting source bytes', async () => {
    await writeFile(join(data, 'maps/community/sample/map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    const corrections = await load();
    const [map] = await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
    expect(map?.script?.missions[0]?.goals).toEqual([
      { key: 'goal', values: ['GoodsGlobal', '0', 'crockery', '1'] },
    ]);
    const terrain = JSON.parse(await readFile(join(temp.path, 'out/maps/sample.json'), 'utf8'));
    expect(terrain.entities.humans).toHaveLength(1);
    expect(Uint8Array.from(await corrections.read(join(data, FILE)))).toEqual(bytes);
    expect(() => corrections.assertApplied()).not.toThrow();
  });
});
