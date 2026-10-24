import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr, rawIrUnderTest } from '../helpers.js';

const SCRIPT_SUFFIX = '.script.json';

describe.runIf(hasRealIr())("a map's [misc_humangraphics] looks", () => {
  it('name only recipes the humanPalettes lane carries, across every map that writes one', () => {
    const lane = (rawIrUnderTest() as { humanPalettes: { recipes: { name: string }[] } }).humanPalettes;
    const recipes = new Set(lane.recipes.map((r) => r.name));
    const mapsDir = resolve(contentDir(), 'maps');
    const unknown: string[] = [];
    let rows = 0;
    for (const file of readdirSync(mapsDir).filter((f) => f.endsWith(SCRIPT_SUFFIX))) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir, file), 'utf8')));
      for (const { recipe } of script.humanPalettes) {
        rows++;
        if (!recipes.has(recipe)) unknown.push(`${file}: ${recipe}`);
      }
    }
    expect(rows).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});
