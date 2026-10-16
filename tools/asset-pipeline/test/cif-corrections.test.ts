import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CifLine, decodeCifStringArray } from '@open-northland/formats/cif';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import { loadSourceCorrections } from '../src/corrections.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

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

/** Authored scaffold with pinned properties and mission indices, not a copied source map. */
function guidanceLines(): CifLine[] {
  const lines = Array.from({ length: 125 }, (): CifLine => ({ level: 2, text: 'unused 0' }));
  const put = (line: number, text: string, level = 2): void => {
    lines[line - 1] = { level, text };
  };
  for (const line of [1, 5, 9, 13, 17, 51, 61, 68, 82, 94, 104, 109, 120]) put(line, 'MissionData', 1);
  put(52, 'debuginfo "found"');
  put(59, 'result "PlayCutscene" 5 1');
  put(60, 'result "ActivateMission" 6');
  put(62, 'debuginfo "home"');
  put(63, 'description -1');
  put(64, 'goal "HumansWithHome" 0 2');
  put(65, 'result "PlayCutscene" 6 1');
  put(67, 'result "ActivateMission" 7');
  put(96, 'active 1');
  put(97, 'successfullif 3');
  for (const [line, id, range] of [
    [98, 3, 20],
    [99, 4, 10],
    [100, 5, 10],
    [101, 6, 10],
  ] as const) {
    put(line, `goal "FindPosByHumans" ${id} 225 135 ${range}`);
  }
  put(102, 'result "PlayCutscene" 8 1');
  put(103, 'result "ActivateMission" 10');
  put(107, 'goal "TimeGone" 30');
  put(108, 'result "PlayCutscene" 9 1');
  put(111, 'active 1');
  for (let id = 2; id <= 6; id++) put(110 + id, `goal "FindPosByHumans" ${id} 101 288 80`);
  put(117, 'result "PlayCutscene" 10 1');
  return lines;
}

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

  it('keeps the named lesson correction gated on crockery in both the overall and individual goal', async () => {
    const named = JSON.parse(
      await readFile(new URL('../corrections/tutorial-004-pottery.json', import.meta.url), 'utf8'),
    );
    // An authored scaffold, not a copied map: only the two stale goal properties occupy their pinned
    // decoded positions. Re-pin this synthetic file's bytes while exercising the committed edits.
    const lines = Array.from({ length: 178 }, () => ({ level: 2, text: 'description -1' }));
    lines[0] = { level: 1, text: 'MissionData' };
    lines[1] = { level: 2, text: 'debuginfo "summary"' };
    lines[18] = { level: 2, text: 'goal "BuildHouses" 0 "work pottery 02" 1 0' };
    lines[174] = { level: 1, text: 'MissionData' };
    lines[175] = { level: 2, text: 'debuginfo "product"' };
    lines[177] = { level: 2, text: 'goal "BuildHouses" 0 "work pottery 02" 1 0' };
    const source = buildStringCif(lines);
    await writeFile(join(data, FILE), source);
    await writeFile(join(data, 'maps/community/sample/map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    await writeFile(
      join(dir, 'lesson.json'),
      JSON.stringify({
        ...named,
        file: FILE,
        sha256: createHash('sha256').update(source).digest('hex'),
      }),
    );
    const corrections = await loadSourceCorrections(dir, data);
    const [map] = await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
    expect(map?.script?.missions.map((mission) => mission.goals.map((goal) => goal.values))).toEqual([
      [
        ['BuildHouses', '0', 'work pottery 01', '1', '0'],
        ['GoodsGlobal', '0', 'crockery', '1'],
      ],
      [['GoodsGlobal', '0', 'crockery', '1']],
    ]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('gives the named shared-home step a description and reveals it only when activated', async () => {
    const named = JSON.parse(
      await readFile(new URL('../corrections/tutorial-001-mission-guidance.json', import.meta.url), 'utf8'),
    );
    // Only the edited properties occupy their pinned positions; the remaining scaffold is synthetic.
    const lines = guidanceLines();
    const source = buildStringCif(lines);
    await writeFile(join(data, FILE), source);
    await writeFile(join(data, 'maps/community/sample/map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    await writeFile(
      join(dir, 'lesson.json'),
      JSON.stringify({
        ...named,
        file: FILE,
        sha256: createHash('sha256').update(source).digest('hex'),
      }),
    );
    const corrections = await loadSourceCorrections(dir, data);
    const [map] = await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
    const found = map?.script?.missions[5];
    const home = map?.script?.missions[6];
    expect(found?.results.map((result) => result.values)).toEqual([
      ['PlayCutscene', '5', '1'],
      ['ActivateMission', '6'],
      ['SetVisible', '6', '1'],
    ]);
    expect(home?.descriptionStringId).toBe(5);
    expect(home?.visible).toBeUndefined();
    expect(home?.goals.map((goal) => goal.values)).toEqual([['HumansWithHome', '0', '2']]);
    expect(home?.results.map((result) => result.values)).toEqual([
      ['PlayCutscene', '6', '1'],
      ['ActivateMission', '7'],
    ]);
    const missions = map?.script?.missions;
    expect(missions?.[9]?.successfullIf).toBe(3);
    expect(missions?.[9]?.goals.map((goal) => goal.values)).toEqual([
      ['FindPosByHumans', '6', '225', '135', '10'],
    ]);
    expect(missions?.[9]?.results.map((result) => result.values)).toEqual([
      ['PlayCutscene', '8', '1'],
      ['ActivateMission', '10'],
    ]);
    expect(missions?.[10]?.goals.map((goal) => goal.values)).toEqual([['TimeGone', '30']]);
    expect(missions?.[10]?.results.map((result) => result.values)).toEqual([['PlayCutscene', '9', '1']]);
    expect(missions?.[11]?.goals.map((goal) => goal.values)).toEqual(
      [2, 3, 4, 5, 6].map((id) => ['FindPosByHumans', String(id), '101', '288', '80']),
    );
    expect(() => corrections.assertApplied()).not.toThrow();
  });
});
