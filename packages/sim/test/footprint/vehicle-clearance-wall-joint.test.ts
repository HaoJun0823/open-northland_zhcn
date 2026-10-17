import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { type ScriptLandscapeType, Simulation, type TerrainMap } from '../../src/index.js';
import { walkBodyOf } from '../../src/systems/footprint/building-blocked-cache.js';
import { buildingFootprintOf } from '../../src/systems/footprint/geometry.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { testContent } from '../fixtures/content.js';
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

/** A square building whose door sits at its centre, so its passage runs several nodes to open ground. */
const DEEP_HALL = 77;
const DEEP_HALL_HALF_SPAN = 3;
const DEEP_HALL_BODY = Array.from({ length: 2 * DEEP_HALL_HALF_SPAN + 1 }, (_, row) =>
  Array.from({ length: 2 * DEEP_HALL_HALF_SPAN + 1 }, (_, col) => ({
    dx: col - DEEP_HALL_HALF_SPAN,
    dy: row - DEEP_HALL_HALF_SPAN,
  })),
).flat();
/** Its anchor: the passage leaves through the joint's corner, more than the seal reach from the door. */
const DEEP_HALL_ANCHOR = { x: 20, y: 24 };
/** Wide enough that a change this size takes the local recompute rather than a whole-map pass. */
const LOCAL_RECOMPUTE_MAP_NODES = 160;

describe('vehicleClearance - a door passage beside a wall joint', () => {
  it('re-derives the classes around the seal the passage pushes onto the other corner', () => {
    const base = testContent();
    const content = parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        {
          typeId: DEEP_HALL,
          id: 'deep_hall',
          kind: 'workplace',
          workers: [],
          stock: [],
          recipes: [],
          footprint: {
            blocked: DEEP_HALL_BODY,
            familyBody: DEEP_HALL_BODY,
            reserved: DEEP_HALL_BODY,
            door: { dx: 0, dy: 0 },
          },
        },
      ],
    });
    const map: TerrainMap = {
      ...grassNodeMap(LOCAL_RECOMPUTE_MAP_NODES, LOCAL_RECOMPUTE_MAP_NODES),
      landscapes: { types: [WALL], placements: [] },
    };
    const sim = new Simulation({ seed: 1, content, map });
    const terrain = terrainOf(sim);
    for (const [x, y] of JOINT) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL_GFX,
        x,
        y,
        tribe: VIKING,
        underConstruction: false,
      });
      sim.step();
    }
    vehicleClearance(sim.world, ctxOf(sim), terrain);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: DEEP_HALL,
      x: DEEP_HALL_ANCHOR.x,
      y: DEEP_HALL_ANCHOR.y,
      tribe: VIKING,
      force: true,
    });
    sim.step();
    vehicleClearance(sim.world, ctxOf(sim), terrain);

    const footprint = buildingFootprintOf(sim.content, DEEP_HALL, VIKING);
    if (footprint === undefined) throw new Error('deep hall fixture lost its footprint');
    const { passage } = walkBodyOf(terrain, footprint, DEEP_HALL_ANCHOR.x, DEEP_HALL_ANCHOR.y);
    expect(passage.length).toBeGreaterThan(1);
    expect(sim.world.verifyCaches().filter((m) => m.includes('vehicleClearance'))).toEqual([]);
  });
});
