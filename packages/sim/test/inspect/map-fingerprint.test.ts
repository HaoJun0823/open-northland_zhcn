import { GROUND_LAND, terrainGridFingerprint } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  LandscapePlacements,
  type ScriptLandscapePlacement,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { mapFingerprint } from '../../src/inspect/map-fingerprint.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** Past a byte, so the continent lane compacts to 16 bits rather than 8. */
const WIDE_CONTINENT = 300;
const TINT_STEPS = 7;
/** One past what a type id column holds. */
const PAST_UINT16 = 1 << 16;

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

  it('digests columnar placements as the objects they hold', () => {
    const listed: ScriptLandscapePlacement[] = [
      { id: 0, typeId: 3, hx: 1, hy: 2, level: 1 },
      { id: 2, typeId: 4, hx: 0, hy: 1, level: 52, resourceBacked: true },
    ];
    const map: TerrainMap = { ...grassCellMap(4, 3), landscapes: { types: [], placements: listed } };
    const columns = { ...map, landscapes: { types: [], placements: LandscapePlacements.from(listed) } };
    expect(mapFingerprint(columns)).toBe(mapFingerprint(map));
    expect(
      mapFingerprint({ ...map, landscapes: { types: [], placements: new LandscapePlacements(0) } }),
    ).toBe(mapFingerprint({ ...map, landscapes: { types: [], placements: [] } }));
  });

  it('refuses a placement its columns cannot hold', () => {
    expect(() => LandscapePlacements.from([{ id: 0, typeId: PAST_UINT16, hx: 0, hy: 0, level: 1 }])).toThrow(
      RangeError,
    );
  });

  it('is undefined for a mapless sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.mapFingerprint).toBeUndefined();
  });
});
