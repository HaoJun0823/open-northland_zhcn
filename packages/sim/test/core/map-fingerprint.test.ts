import { GROUND_LAND, terrainGridFingerprint } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Simulation, type TerrainMap } from '../../src/index.js';
import { mapFingerprint } from '../../src/inspect/map-fingerprint.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** Past a byte, so the continent lane compacts to 16 bits rather than 8. */
const WIDE_CONTINENT = 300;
const TINT_STEPS = 7;

describe('Simulation.mapFingerprint', () => {
  it('digests the exact half-cell grid the sim navigates', () => {
    const map = grassCellMap(4, 3);
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    expect(sim.mapFingerprint).toBe(terrainGridFingerprint(map));
  });

  it('digests the map as given while the sim holds typed copies of its lanes', () => {
    const grass = grassCellMap(4, 3);
    const nodes = grass.width * grass.height;
    const cells = nodes / 4;
    const map: TerrainMap = {
      ...grass,
      groundKinds: new Array<number>(nodes).fill(GROUND_LAND),
      waterContinents: Array.from({ length: nodes }, (_, i) => (i % 2 === 0 ? WIDE_CONTINENT : i)),
      tints: Array.from({ length: cells }, (_, i) => i % TINT_STEPS),
    };
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    expect(sim.terrain?.waterContinents).toBeInstanceOf(Uint16Array);
    expect(sim.mapFingerprint).toBe(mapFingerprint(map));
  });

  it('is undefined for a mapless sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.mapFingerprint).toBeUndefined();
  });
});
