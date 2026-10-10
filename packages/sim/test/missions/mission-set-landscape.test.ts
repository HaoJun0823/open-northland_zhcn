import { describe, expect, it } from 'vitest';
import { Simulation, type TerrainMap } from '../../src/index.js';
import { setScriptedLandscape } from '../../src/systems/landscape/edits.js';
import { landscapesWithin } from '../../src/systems/landscape/view.js';
import { ctxOf } from '../fixtures/context.js';
import { map, POINT, terrainOf } from './landscape-support.js';
import { HUT, houseContent, VIKING } from './support.js';

const WALL = 1;
const SMOKE = 2;
/** A land-only object capped at level 4, whose build area reaches one node east of its walk cell. */
const STONE = 3;
const STONE_MAX = 4;
/** Decor without a walk area. */
const DECOR = 4;

/** The landscape fixture (west half land, a wall at POINT, smoke at (5,5)) with a stone and a decor. */
function sim(): Simulation {
  const base = map();
  if (base.landscapes === undefined) throw new Error('landscape fixture');
  const withTypes: TerrainMap = {
    ...base,
    landscapes: {
      ...base.landscapes,
      types: [
        ...base.landscapes.types,
        {
          typeId: STONE,
          walk: [{ dx: 0, dy: 0 }],
          build: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
          ],
          groups: [],
          maxLevel: STONE_MAX,
          ground: { anywhere: false, land: true, water: false },
        },
        { typeId: DECOR, walk: [], build: [], groups: [] },
      ],
    },
  };
  return new Simulation({ seed: 1, content: houseContent(), map: withTypes });
}

function lay(s: Simulation, point: { hx: number; hy: number }, typeId: number, level: number, force = false) {
  return setScriptedLandscape(s.world, ctxOf(s), point, typeId, level, force);
}

function standing(s: Simulation, point: { hx: number; hy: number }) {
  return landscapesWithin(s.world, terrainOf(s), point, 0);
}

describe('a script SetLandscape', () => {
  it('caps the level at the type maximum and reads a negative level as that maximum', () => {
    const s = sim();
    expect(lay(s, { hx: 4, hy: 8 }, STONE, 9)).not.toBeNull();
    expect(standing(s, { hx: 4, hy: 8 })).toMatchObject([{ typeId: STONE, level: STONE_MAX }]);
    expect(lay(s, { hx: 6, hy: 10 }, STONE, -1)).not.toBeNull();
    expect(standing(s, { hx: 6, hy: 10 })).toMatchObject([{ typeId: STONE, level: STONE_MAX }]);
  });

  it('clears the anchor at level 0', () => {
    const s = sim();
    expect(lay(s, POINT, STONE, 0)).not.toBeNull();
    expect(standing(s, POINT)).toEqual([]);
    expect(s.landscapeEdits().removed).toEqual([0]);
  });

  it('lays nothing on ground the type may not stand on, and lays on the map border', () => {
    const s = sim();
    const version = s.world.mutationVersion;
    // The anchor is water, then the anchor is land but the build area's east node is not.
    expect(lay(s, { hx: 9, hy: 6 }, STONE, 1)).toBeNull();
    expect(lay(s, { hx: 7, hy: 6 }, STONE, 1)).toBeNull();
    expect(s.world.mutationVersion).toBe(version);
    expect(lay(s, { hx: 6, hy: 6 }, STONE, 1)).not.toBeNull();
    // Cell (1,1) lies in the two-cell map border, which only an OnLand vertex colour write skips.
    expect(lay(s, { hx: 2, hy: 2 }, DECOR, 1)).toEqual([]);
  });

  it('leaves the same type at the same level standing and replaces any other only when forced', () => {
    const s = sim();
    lay(s, { hx: 4, hy: 8 }, STONE, 2);
    const [first] = standing(s, { hx: 4, hy: 8 });
    expect(lay(s, { hx: 4, hy: 8 }, STONE, 2)).toEqual([]);
    expect(standing(s, { hx: 4, hy: 8 })).toEqual([first]);
    // The standing stone's own build area covers the walk cell, so only a forced write replaces it.
    expect(lay(s, { hx: 4, hy: 8 }, STONE, 3)).toBeNull();
    expect(lay(s, { hx: 4, hy: 8 }, STONE, 3, true)).toEqual([]);
    expect(standing(s, { hx: 4, hy: 8 })).toMatchObject([{ typeId: STONE, level: 3 }]);
    expect(standing(s, { hx: 4, hy: 8 })[0]?.id).not.toBe(first?.id);
  });

  it('unforced, needs a walk area clear of build areas and clears what stands on it; forced, neither', () => {
    const s = sim();
    // The wall at POINT keeps (10,8) in its build area, which a wall one point east would walk on.
    expect(lay(s, { hx: 9, hy: 8 }, WALL, 1)).toBeNull();
    expect(lay(s, { hx: 9, hy: 8 }, WALL, 1, true)).toEqual([]);
    expect(standing(s, POINT)).toMatchObject([{ id: 0 }]);
    // A wall whose walk area covers the smoke's point clears the smoke.
    expect(standing(s, { hx: 5, hy: 5 })).toMatchObject([{ typeId: SMOKE }]);
    expect(lay(s, { hx: 4, hy: 5 }, WALL, 1)).not.toBeNull();
    expect(standing(s, { hx: 5, hy: 5 })).toEqual([]);
    expect(standing(s, { hx: 4, hy: 5 })).toMatchObject([{ typeId: WALL }]);
  });

  it('needs an anchor nothing blocks for a type without a walk area, forced or not', () => {
    const s = sim();
    // (9,8) is the standing wall's second walk cell.
    expect(lay(s, { hx: 9, hy: 8 }, DECOR, 1)).toBeNull();
    expect(lay(s, { hx: 9, hy: 8 }, DECOR, 1, true)).toBeNull();
    expect(lay(s, { hx: 6, hy: 6 }, DECOR, 1)).toEqual([]);
  });

  it('lays nothing on a building', () => {
    const s = sim();
    s.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, tribe: VIKING, x: 4, y: 10, force: true });
    s.run(1);
    expect(lay(s, { hx: 4, hy: 10 }, DECOR, 1, true)).toBeNull();
    expect(lay(s, { hx: 6, hy: 10 }, DECOR, 1, true)).toEqual([]);
  });
});
