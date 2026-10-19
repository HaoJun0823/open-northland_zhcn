import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import { CORRECTIONS_DIR, type LineCorrection, loadSourceCorrections } from '../src/corrections.js';
import { readSourceFile } from '../src/roots.js';
import { extractIniTables } from '../src/stages/ir/tables.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

const MAP_FOLDER = 'maps/community/Swapped Camps';
const AI_INC = `${MAP_FOLDER}/ai.inc`;
const SHIPPED_AI =
  '[aidata]\r\nAI_SoldiersDefaultPosition 1 40 2 50\r\nAI_UnitLimit 1 30\r\n' +
  'AI_SoldiersDefaultPosition 2 10 90 55\r\n';
const SWAP = [
  { from: 'AI_SoldiersDefaultPosition 1 40 2 50', to: 'AI_SoldiersDefaultPosition 1 10 90 55' },
  { from: 'AI_SoldiersDefaultPosition 2 10 90 55', to: 'AI_SoldiersDefaultPosition 2 40 2 50' },
];

const sha256 = (text: string): string => createHash('sha256').update(text, 'latin1').digest('hex');

describe('source corrections', () => {
  let temp: TempDir;
  let mod: string;
  let dir: string;

  const writeCorrection = (id: string, correction: object): Promise<void> =>
    writeFile(join(dir, `${id}.json`), JSON.stringify(correction));
  const writeMod = async (rel: string, data: string | Uint8Array): Promise<string> => {
    const path = join(mod, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof data === 'string' ? Buffer.from(data, 'latin1') : data);
    return path;
  };

  beforeEach(async () => {
    temp = await makeTempDir('corrections');
    mod = join(temp.path, 'mod');
    dir = join(temp.path, 'corrections');
    await mkdir(dir, { recursive: true });
  });

  afterEach(() => temp.cleanup());

  it('swaps the named lines and keeps every other byte of that file', async () => {
    const path = await writeMod(AI_INC, SHIPPED_AI);
    const other = await writeMod(`${MAP_FOLDER}/player.inc`, 'AI_SoldiersDefaultPosition 1 40 2 50\n');
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(
      '[aidata]\r\nAI_SoldiersDefaultPosition 1 10 90 55\r\nAI_UnitLimit 1 30\r\n' +
        'AI_SoldiersDefaultPosition 2 40 2 50\r\n',
    );
    expect(Buffer.from(await corrections.read(other)).toString('latin1')).toBe(
      'AI_SoldiersDefaultPosition 1 40 2 50\n',
    );
    expect(() => corrections.assertApplied()).not.toThrow();
    // The shipped bytes stay reachable by the corrected file's name, any case, for overlay bases.
    expect(Buffer.from(corrections.shipped(AI_INC.toUpperCase()) ?? []).toString('latin1')).toBe(SHIPPED_AI);
    expect(corrections.shipped(`${MAP_FOLDER}/player.inc`)).toBeUndefined();
  });

  it('reads a changed file as shipped and fails the run until the correction is revisited', async () => {
    const path = await writeMod(AI_INC, `${SHIPPED_AI}AI_UnitLimit 2 30\r\n`);
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toContain(SWAP[0]?.from);
    expect(corrections.unapplied().map(({ id }) => id)).toEqual(['swap']);
    expect(() => corrections.assertApplied()).toThrow(/swap \(.*ai\.inc\): the file changed/);
  });

  it('expands a line into the listed lines, keeping its line end on each', async () => {
    const path = await writeMod(AI_INC, SHIPPED_AI);
    const lines = [{ from: 'AI_UnitLimit 1 30', to: ['AI_UnitLimit 1 30', 'AI_UnitLimit 2 30'] }];
    await writeCorrection('insert', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(
      '[aidata]\r\nAI_SoldiersDefaultPosition 1 40 2 50\r\nAI_UnitLimit 1 30\r\nAI_UnitLimit 2 30\r\n' +
        'AI_SoldiersDefaultPosition 2 10 90 55\r\n',
    );
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('edits one numbered line among identical ones, deletes for an empty list, and reads and writes an encoding', async () => {
    const shipped = '[a]\r\n[a]\r\nx\r\n\xe1\r\n\xe1\xe2\r\n[end]\r\n';
    const path = await writeMod(AI_INC, shipped);
    const lines = [
      { from: '[a]', to: [], line: 2 },
      { from: '\u0431', to: '\u0432b', line: 4 },
    ];
    await writeCorrection('numbered', {
      reason: 'test',
      file: AI_INC,
      sha256: sha256(shipped),
      encoding: 'windows-1251',
      lines,
    });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(
      '[a]\r\nx\r\n\xe2b\r\n\xe1\xe2\r\n[end]\r\n',
    );
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('writes a UTF-8 correction as UTF-8 bytes', async () => {
    const shipped = 'a\r\nb\r\n';
    const path = await writeMod(AI_INC, shipped);
    await writeCorrection('utf8', {
      reason: 'test',
      file: AI_INC,
      sha256: sha256(shipped),
      encoding: 'utf-8',
      lines: [{ from: 'b', to: '\u201eż\u201d' }],
    });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('utf8')).toBe('a\r\n\u201eż\u201d\r\n');
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('fails the run for a numbered line that no longer reads its "from"', async () => {
    const path = await writeMod(AI_INC, SHIPPED_AI);
    const lines = [{ from: 'AI_UnitLimit 1 30', to: 'x', line: 1 }];
    await writeCorrection('numbered', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines });
    const corrections = await loadSourceCorrections(dir, mod);

    await corrections.read(path);
    expect(() => corrections.assertApplied()).toThrow(/line 1 does not read/);
  });

  it('fails the run for a correction no stage read', async () => {
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);
    expect(() => corrections.assertApplied()).toThrow(/swap .*never read/);
  });

  it('fails the run for a line matching no line or several, unless the edit names every one', async () => {
    const shipped = 'a\r\na\r\nb\r\n';
    const path = await writeMod(AI_INC, shipped);
    for (const from of ['a', 'x']) {
      await writeCorrection('lines', {
        reason: 'test',
        file: AI_INC,
        sha256: sha256(shipped),
        lines: [{ from, to: 'c' }],
      });
      const corrections = await loadSourceCorrections(dir, mod);
      expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(shipped);
      expect(() => corrections.assertApplied()).toThrow(/instead of one/);
    }
    await writeCorrection('lines', {
      reason: 'test',
      file: AI_INC,
      sha256: sha256(shipped),
      lines: [
        { from: 'a', to: 'c', every: true },
        { from: 'b', to: 'd' },
      ],
    });
    const corrections = await loadSourceCorrections(dir, mod);
    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe('c\r\nc\r\nd\r\n');
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('confines a sectioned edit to the block holding its section line', async () => {
    const shipped =
      '[GfxHouse]\r\nEditName "mill"\r\nLayer 0 72\r\n\r\n[GfxHouse]\r\nEditName "hut"\r\nLayer 0 72\r\n' +
      '[GfxHouse]\r\nEditName "well"\r\nLayer 0 72\r\n';
    const path = await writeMod(AI_INC, shipped);
    const edit = (section: string) => ({
      reason: 'test',
      file: AI_INC,
      sha256: sha256(shipped),
      lines: [{ section, from: 'Layer 0 72', to: 'Layer 0 4' }],
    });
    await writeCorrection('sectioned', edit('EditName "hut"'));
    const corrections = await loadSourceCorrections(dir, mod);
    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(
      shipped.replace('"hut"\r\nLayer 0 72', '"hut"\r\nLayer 0 4'),
    );
    expect(() => corrections.assertApplied()).not.toThrow();

    for (const [section, why] of [
      ['EditName "barn"', /section .* matches 0 lines/],
      ['[GfxHouse]', /section .* matches 3 lines/],
    ] as const) {
      await writeCorrection('sectioned', edit(section));
      const refused = await loadSourceCorrections(dir, mod);
      expect(Buffer.from(await refused.read(path)).toString('latin1')).toBe(shipped);
      expect(() => refused.assertApplied()).toThrow(why);
    }
  });

  it('refuses a malformed correction or two naming one file', async () => {
    const valid = { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP };
    const refused: readonly [object, RegExp][] = [
      [{ ...valid, reason: ' ' }, /reason/],
      [{ ...valid, sha256: 'ABC' }, /sha256/],
      [{ ...valid, lines: [] }, /at least one edit/],
      [{ ...valid, lines: [{ from: 'ż', to: 'z' }] }, /printable ASCII/],
      [{ ...valid, lines: [{ from: 'a', to: 'z', line: 0 }] }, /"line"/],
      [{ ...valid, lines: [{ from: 'a', to: 'z', line: 2, every: true }] }, /"line"/],
      [{ ...valid, encoding: 'no-such-codepage' }, /"encoding"/],
      [{ ...valid, encoding: 'utf-16le' }, /"encoding"/],
      [{ ...valid, lines: [{ from: 'a', to: ['z', 'ż'] }] }, /printable ASCII/],
      [{ ...valid, encoding: 'windows-1251', lines: [{ from: 'a', to: 'ż' }] }, /windows-1251 cannot write/],
      [{ ...valid, lines: [{ from: 'a', to: 'z', every: false }] }, /"every"/],
      [{ ...valid, lines: [{ from: 'a', to: 'z', section: '' }] }, /"section"/],
      [{ ...valid, note: 'x' }, /unknown key "note"/],
    ];
    for (const [correction, why] of refused) {
      await writeCorrection('bad', correction);
      await expect(loadSourceCorrections(dir, mod)).rejects.toThrow(why);
    }
    await writeCorrection('bad', valid);
    await writeCorrection('twin', { ...valid, file: AI_INC.toUpperCase() });
    await expect(loadSourceCorrections(dir, mod)).rejects.toThrow(/bad and twin both name/);
  });

  it('holds none when the directory is gone', async () => {
    const corrections = await loadSourceCorrections(join(temp.path, 'absent'), mod);
    expect(corrections.list).toEqual([]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('feeds the corrected script file to the map stage', async () => {
    await writeMod(`${MAP_FOLDER}/map.dat`, buildMapDat(1, 1, [2, 2, 2, 2]));
    await writeMod(AI_INC, SHIPPED_AI);
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const roots = { data: mod, corrections: await loadSourceCorrections(dir, mod) };

    const [map] = await convertMapDatTree(roots, join(temp.path, 'out'));
    expect(map?.script?.ai.map((row) => [row.player, row.defaultPosition])).toEqual([
      [1, { x: 10, y: 90, range: 55 }],
      [2, { x: 40, y: 2, range: 50 }],
    ]);
    expect(() => roots.corrections.assertApplied()).not.toThrow();
    // Without corrections the stage reads the file as shipped.
    const shipped = await readSourceFile({ data: mod }, join(mod, AI_INC));
    expect(Buffer.from(shipped).toString('latin1')).toBe(SHIPPED_AI);
  });

  it('feeds the corrected houses table to the IR stage', async () => {
    const housesIni = 'rules/buildings/houses.ini';
    const shipped =
      '[GfxHouse]\r\nEditName "hut"\r\nLogicTribeType 2\r\nLogicType 0 29\r\n' +
      'GfxBobLibs "data\\engine2d\\bin\\bobs\\test_house.bmd"\r\nGfxPalette "house01"\r\nGfxBobId 0 0\r\n' +
      'GfxBobConstructionLayer 0 0 72 -1 0 100\r\n';
    const path = await writeMod(housesIni, shipped);
    await writeCorrection('stages', {
      reason: 'test',
      file: housesIni,
      sha256: sha256(shipped),
      lines: [
        { from: 'GfxBobConstructionLayer 0 0 72 -1 0 100', to: 'GfxBobConstructionLayer 0 0 2 -1 0 100' },
      ],
    });
    const roots = { data: mod, corrections: await loadSourceCorrections(dir, mod) };

    const { constructionLayers } = await extractIniTables(roots, [{ path, file: housesIni, layer: 'mod' }]);
    expect(constructionLayers.map((row) => row.bobId)).toEqual([2]);
    expect(() => roots.corrections.assertApplied()).not.toThrow();
  });

  it('arms the death watcher once for every recruitment route without changing other results', async () => {
    const correction = JSON.parse(
      await readFile(join(CORRECTIONS_DIR, 'wielkie-sprzatanie-bjarni-death-watch.json'), 'utf8'),
    ) as Pick<LineCorrection, 'reason' | 'file' | 'sha256' | 'lines'>;
    const activate = 'result "ActivateMission" 74';
    const routes = [0, 101, 102, 103].map((human) =>
      [
        '[MissionData]',
        'description -1',
        `goal "FindPosByHumans" ${human} 477 189 1`,
        'result "SetHumanName" 100 100',
        ...(human === 101 ? [activate] : []),
        'result "DeactivateMission" 99',
      ].join('\r\n'),
    );
    const unrelated = '[MissionData]\r\ndescription -1\r\ngoal "TimeGone" 12\r\nresult "ActivateMission" 9';
    const shipped = [...routes, unrelated, ''].join('\r\n');
    const folder = dirname(correction.file);
    await writeMod(`${folder}/map.dat`, buildMapDat(1, 1, [2, 2, 2, 2]));
    const scriptPath = await writeMod(correction.file, shipped);
    await writeCorrection('recruitment', { ...correction, sha256: sha256(shipped) });
    const corrections = await loadSourceCorrections(dir, mod);
    const corrected = Buffer.from(await corrections.read(scriptPath)).toString('latin1');
    expect(corrected).toBe(
      [
        ...routes.map((route, index) =>
          index === 1
            ? route
            : route.replace('result "SetHumanName" 100 100', `result "SetHumanName" 100 100\r\n${activate}`),
        ),
        unrelated,
        '',
      ].join('\r\n'),
    );
    const [map] = await convertMapDatTree({ data: mod, corrections }, join(temp.path, 'out'));
    expect(
      map?.script?.missions
        .slice(0, 4)
        .map(
          (mission) =>
            mission.results.filter(
              (result) => result.values[0] === 'ActivateMission' && result.values[1] === '74',
            ).length,
        ),
    ).toEqual([1, 1, 1, 1]);
    expect(map?.script?.missions[4]?.results).toEqual([{ key: 'result', values: ['ActivateMission', '9'] }]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('runs the quarry reveal and counts army 566 in the victory over Zohanowaty', async () => {
    const correction = JSON.parse(
      await readFile(join(CORRECTIONS_DIR, 'boso-przez-swiat-mission-script.json'), 'utf8'),
    ) as Pick<LineCorrection, 'reason' | 'file' | 'sha256' | 'lines'>;
    const shipped = [
      '[MissionData]',
      'description -1',
      'goal "IsMissionDone" 51',
      'result \'ExploreArea" 0 478 54 8',
      'result "SendHuman" 104 474 63',
      '[MissionData]',
      'description -1',
      'goal "HumansDied" 556',
      'goal "HumansDied" 567',
      'result "RemoveHumans" 104',
      '',
    ].join('\r\n');
    const folder = dirname(correction.file);
    await writeMod(`${folder}/map.dat`, buildMapDat(1, 1, [2, 2, 2, 2]));
    await writeMod(correction.file, shipped);
    await writeCorrection('boso', { ...correction, sha256: sha256(shipped) });
    const corrections = await loadSourceCorrections(dir, mod);
    const [map] = await convertMapDatTree({ data: mod, corrections }, join(temp.path, 'out'));
    const [quarry, victory] = map?.script?.missions ?? [];
    expect(quarry?.results[0]).toEqual({ key: 'result', values: ['ExploreArea', '0', '478', '54', '8'] });
    expect(victory?.goals.map((goal) => goal.values)).toEqual([
      ['HumansDied', '566'],
      ['HumansDied', '567'],
    ]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('parses every committed correction', async () => {
    await expect(loadSourceCorrections(CORRECTIONS_DIR, mod)).resolves.toBeDefined();
  });
});
