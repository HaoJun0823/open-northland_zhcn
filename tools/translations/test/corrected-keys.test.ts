import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { correctedMapKeys, readGermanCorrections } from '../src/import/corrected-keys.js';

const PROBE_MAP = { id: 'probe_map', sha256: 'a'.repeat(64) };
const OTHER_DAT = 'b'.repeat(64);
const BASIS_DIGEST = 'c'.repeat(64);

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A temporary folder holding `files` by relative path, removed after the test. */
async function folder(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'on-corrections-'));
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), JSON.stringify(value));
  }
  return dir;
}

const germanOverlay = (strings: Record<string, string>, briefings: Record<string, string>): object => ({
  version: 1,
  map: PROBE_MAP.id,
  basis: { lang: 'ger', digest: BASIS_DIGEST },
  strings,
  briefings,
});

describe('German corrections', () => {
  const basis = {
    strings: { '1': 'Eins', '2': 'Zwei', '3': 'Drei' },
    briefings: { a: 'Vorher.\nKlicke mit der RECHTEN Maustaste.', b: 'Nichts.', c: 'Später.' },
  };
  const translation = {
    strings: { '1': '一', '2': '二', '3': '三' },
    briefings: { a: '甲', b: '乙', c: '丙' },
  };

  it('names the object ids, map strings and briefing blocks whose German a correction changes', async () => {
    const root = await folder({
      'corrections/strings/tables.json': [
        { lang: 'ger', table: 'jobsPlural', id: 3, from: 'Fässer', to: 'Fässchen', reason: '' },
        { lang: 'pol', table: 'goods', id: 4, from: 'a', to: 'b', reason: '' },
        { lang: 'ger', table: 'misc', id: 5, from: 'a', to: 'b', reason: '' },
      ],
      'corrections/strings/maps.json': [
        { map: 'probe_map', lang: 'ger', id: 2, from: 'a', to: 'b', reason: '' },
      ],
      'corrections/probe-briefing-ger.json': {
        file: 'maps/community/Probe Map/text/ger/briefings/briefings.txt',
        sha256: '',
        lines: [{ from: 'Klicke mit der RECHTEN Maustaste.', to: 'Klicke mit der LINKEN Maustaste.' }],
      },
      'corrections/camp-strings-ger.json': {
        file: 'campaigns/camp/map_01/text/ger/strings.ini',
        sha256: '',
        lines: [{ from: 'stringn 7 "Alt"', to: 'stringn 7 "Neu"' }],
      },
      'corrections/probe-briefing-pol.json': {
        file: 'maps/community/Probe Map/text/pol/briefings/briefings.txt',
        sha256: '',
        lines: [{ from: 'Kliknij.', to: 'Kliknij lewym.' }],
      },
    });
    const read = await readGermanCorrections(join(root, 'corrections'), join(root, 'translations'));
    expect(read.tables).toEqual(new Map([['jobs', new Set(['3'])]]));
    expect(read.mapStrings).toEqual(
      new Map([
        ['probe_map', new Set(['2'])],
        ['camp-map_01', new Set(['7'])],
      ]),
    );
    expect(correctedMapKeys(read, PROBE_MAP, basis, translation)).toEqual(['string 2', 'block a']);
  });

  it('names the keys a German map overlay of the same map.dat replaces', async () => {
    const root = await folder({
      'corrections/strings/tables.json': [],
      'corrections/strings/maps.json': [],
      [`translations/ger/maps/${PROBE_MAP.sha256}.json`]: germanOverlay({ '3': 'Vier' }, { c: 'Danach.' }),
      [`translations/ger/maps/${OTHER_DAT}.json`]: germanOverlay({ '1': 'Null' }, { b: 'Alles.' }),
    });
    const read = await readGermanCorrections(join(root, 'corrections'), join(root, 'translations'));
    expect(correctedMapKeys(read, PROBE_MAP, basis, translation)).toEqual(['string 3', 'block c']);
  });
});
