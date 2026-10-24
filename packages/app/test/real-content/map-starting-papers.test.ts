import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import { PLACING_PAPER_KINDS } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { paperOfSpecialItem } from '../../src/game/map/starting-papers.js';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * Pin the `[specialItems]` starting papers against the real decoded maps: every authored row must name a
 * kind the papers page can spend and a house the content knows, else a map's opening papers would sit
 * inert or place nothing.
 */

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function scriptFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.script.json'))
    .sort();
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'starting papers on real maps',
  () => {
    it('every authored row spends on a placement and names a house the content builds', async () => {
      const { merge } = await loadContentUnderTest();
      const houses = new Set(merge.content.buildings.map((b) => b.typeId));
      let rows = 0;
      for (const file of scriptFiles()) {
        const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
        for (const row of script.specialItems) {
          rows++;
          const paper = paperOfSpecialItem(row);
          expect(paper, `${file}: ${JSON.stringify(row)}`).toBeDefined();
          if (paper === undefined) continue;
          expect(PLACING_PAPER_KINDS.has(paper.kind), `${file}: ${paper.kind}`).toBe(true);
          if (paper.kind !== 'placeAny')
            expect(houses.has(paper.param), `${file}: house ${paper.param}`).toBe(true);
        }
      }
      expect(rows).toBeGreaterThan(0);
    });
  },
);
