import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { correctedMapKeys, readGermanCorrections } from '../src/import/corrected-keys.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function corrections(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'on-corrections-'));
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), JSON.stringify(value));
  }
  return dir;
}

describe('German corrections', () => {
  it('names the object ids, map strings and briefing blocks whose German a correction changes', async () => {
    const read = await readGermanCorrections(
      await corrections({
        'strings/tables.json': [
          { lang: 'ger', table: 'jobsPlural', id: 3, from: 'Fässer', to: 'Fässchen', reason: '' },
          { lang: 'pol', table: 'goods', id: 4, from: 'a', to: 'b', reason: '' },
          { lang: 'ger', table: 'misc', id: 5, from: 'a', to: 'b', reason: '' },
        ],
        'strings/maps.json': [{ map: 'probe_map', lang: 'ger', id: 2, from: 'a', to: 'b', reason: '' }],
        'probe-briefing-ger.json': {
          file: 'maps/community/Probe Map/text/ger/briefings/briefings.txt',
          sha256: '',
          lines: [{ from: 'Klicke mit der RECHTEN Maustaste.', to: 'Klicke mit der LINKEN Maustaste.' }],
        },
        'camp-strings-ger.json': {
          file: 'campaigns/camp/map_01/text/ger/strings.ini',
          sha256: '',
          lines: [{ from: 'stringn 7 "Alt"', to: 'stringn 7 "Neu"' }],
        },
        'probe-briefing-pol.json': {
          file: 'maps/community/Probe Map/text/pol/briefings/briefings.txt',
          sha256: '',
          lines: [{ from: 'Kliknij.', to: 'Kliknij lewym.' }],
        },
      }),
    );
    expect(read.tables).toEqual(new Map([['jobs', new Set(['3'])]]));
    expect(read.mapStrings).toEqual(
      new Map([
        ['probe_map', new Set(['2'])],
        ['camp-map_01', new Set(['7'])],
      ]),
    );
    const basis = {
      strings: { '1': 'Eins', '2': 'Zwei' },
      briefings: { a: 'Vorher.\nKlicke mit der RECHTEN Maustaste.', b: 'Nichts.' },
    };
    const overlay = { strings: { '1': '一', '2': '二' }, briefings: { a: '甲', b: '乙' } };
    expect(correctedMapKeys(read, 'probe_map', basis, overlay)).toEqual(['string 2', 'block a']);
  });
});
