import { describe, expect, it } from 'vitest';
import type { ScriptLandscapeType, TerrainMap } from '../../src/index.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { mappedSim, terrainOf, VIKING } from './building-placement/support.js';

// A slanted wall joint is closed by a seal on a corner beside the wall cells, which no wall body lists:
// the clearance memo must still re-derive the classes around it.

const WALL_GFX = 691;
const WALL: ScriptLandscapeType = {
  typeId: WALL_GFX,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 1, amount: 1 }] },
};
const MAP_NODES = 48;
/** Two single-node walls one half-row apart on the slant, so they meet in a joint the seal closes. */
const JOINT: readonly (readonly [number, number])[] = [
  [20, 20],
  [19, 21],
];

describe('vehicleClearance - wall joint seals', () => {
  it.each([
    ['first', JOINT],
    ['second', [...JOINT].reverse()],
  ])('re-derives the classes around a seal a wall placed %s makes', (_name, order) => {
    const map: TerrainMap = {
      ...grassNodeMap(MAP_NODES, MAP_NODES),
      landscapes: { types: [WALL], placements: [] },
    };
    const sim = mappedSim(map);
    const terrain = terrainOf(sim);
    const wallAt = ([x, y]: readonly [number, number]): void => {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL_GFX,
        x,
        y,
        tribe: VIKING,
        underConstruction: false,
      });
      sim.step();
    };
    const [first, second] = order;
    if (first === undefined || second === undefined) throw new Error('joint fixture lost a wall');
    wallAt(first);
    vehicleClearance(sim.world, ctxOf(sim), terrain); // the memo now holds the field before the joint
    wallAt(second);
    vehicleClearance(sim.world, ctxOf(sim), terrain);
    expect(sim.world.verifyCaches().filter((m) => m.includes('vehicleClearance'))).toEqual([]);
  });
});
