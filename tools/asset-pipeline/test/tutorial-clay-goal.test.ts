import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CifLine } from '@open-northland/formats/cif';
import { describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import { loadSourceCorrections } from '../src/corrections.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { makeTempDir } from './support/game-tree.js';

describe('tutorial_003 clay goal correction', () => {
  it('gives the clay collector lesson its unused goal string', async () => {
    const temp = await makeTempDir('tutorial-clay-goal');
    try {
      // Synthetic scaffold at the correction's pinned line; no source map is copied into tests.
      const file = 'maps/community/sample/map.cif';
      const lines: CifLine[] = Array.from({ length: 17 }, () => ({ level: 2, text: 'description -1' }));
      lines[0] = { level: 1, text: 'MissionData' };
      lines[14] = { level: 1, text: 'MissionData' };
      lines[15] = { level: 2, text: 'debuginfo "abbauer"' };
      lines[16] = { level: 2, text: 'goal "True"' };
      const bytes = buildStringCif(lines);
      const data = join(temp.path, 'data');
      const dir = join(temp.path, 'corrections');
      await mkdir(join(data, 'maps/community/sample'), { recursive: true });
      await mkdir(dir);
      await writeFile(join(data, file), bytes);
      await writeFile(join(data, 'maps/community/sample/map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
      const named = JSON.parse(
        await readFile(new URL('../corrections/tutorial-003-clay-goal.json', import.meta.url), 'utf8'),
      );
      await writeFile(
        join(dir, 'lesson.json'),
        JSON.stringify({ ...named, file, sha256: createHash('sha256').update(bytes).digest('hex') }),
      );

      const [original] = await convertMapDatTree({ data }, join(temp.path, 'original'));
      const corrections = await loadSourceCorrections(dir, data);
      const [map] = await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
      corrections.assertApplied();

      expect(original?.script?.missions[1]?.descriptionStringId).toBeUndefined();
      expect(map?.script?.missions[1]).toMatchObject({ debugName: 'abbauer', descriptionStringId: 0 });
    } finally {
      await temp.cleanup();
    }
  });
});
