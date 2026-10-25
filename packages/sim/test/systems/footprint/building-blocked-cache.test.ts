import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Palisade,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import {
  type Entity,
  type Fixed,
  fx,
  ONE,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../../src/index.js';
import { buildingBlockedLayer } from '../../../src/systems/footprint/building-blocked-cache.js';
import { walkBlockMask } from '../../../src/systems/footprint/walk-block-mask.js';
import { buildingBlockedCells, constructionSystem } from '../../../src/systems/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { HUT, mappedSim, terrainOf, VIKING } from './building-placement/support.js';

/** The HUT's anchor in every placement fixture - body (5,5)+(6,5), door (4,5). */
const ANCHOR = { x: 5, y: 5 };

/** Every seam that can change the building walk-block set invalidates its memo: membership and the home
 *  tier upgrade's in-place `buildingType` swap. */
describe('buildingBlockedCells memo', () => {
  it('a building appearing or disappearing invalidates the memo', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const before = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(before.size).toBe(0);

    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(hut, Building, { buildingType: HUT, tribe: VIKING, built: ONE, level: 0 });
    const placed = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(placed.has(terrain.nodeAt(ANCHOR.x, ANCHOR.y))).toBe(true);

    sim.world.destroy(hut);
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain).size).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('a home tier upgrade - the in-place buildingType swap - invalidates the memo', () => {
    const { sim, home, growth } = twoTierHome();
    const terrain = terrainOf(sim);
    const before = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(before.has(growth)).toBe(false); // level 0: the growth cell is still open ground

    constructionSystem(sim.world, ctxOf(sim)); // materials present - upgrades in place
    expect(sim.world.get(home, Building).level).toBe(1);
    const after = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(after).not.toBe(before);
    expect(after.has(growth)).toBe(true); // the larger tier's wall is picked up
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags an in-place Building write that bypassed the tracked seam', () => {
    const { sim, home } = twoTierHome();
    const other = sim.world.create();
    sim.world.add(other, Position, positionOfNode(10, 10));
    sim.world.add(other, Building, { buildingType: HOME_S, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    // Defeating the readonly view is the bug the verifier exists to catch: no value-generation bump.
    (sim.world.get(home, Building) as { buildingType: number }).buildingType = HOME_L;
    expect(sim.world.verifyCaches().join('\n')).toContain('buildingBlockedCells');
    // Logged construction progress on another building leaves the verifier armed.
    sim.world.mut(other, Building).built = HALF;
    expect(sim.world.verifyCaches().join('\n')).toContain('buildingBlockedCells');

    // The same write through the seam - logged, so the next read rebuilds.
    sim.world.mut(home, Building).buildingType = HOME_L;
    buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('building blocked layer', () => {
  it('edits one live set and hands the walk mask the nodes that flipped', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const layer = buildingBlockedLayer(sim.world, ctxOf(sim), terrain);
    const mask = walkBlockMask(sim.world, ctxOf(sim), terrain);
    const body = terrain.nodeAt(ANCHOR.x, ANCHOR.y);
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(hut, Building, { buildingType: HUT, tribe: VIKING, built: ONE, level: 0 });
    expect(mask.has(body)).toBe(true);
    expect(buildingBlockedLayer(sim.world, ctxOf(sim), terrain).cells).toBe(layer.cells);
    sim.world.destroy(hut);
    expect(mask.has(body)).toBe(false);
    expect(layer.cells.size).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('building blocked layer - walls and doors', () => {
  it('follows walls, gate swaps and doors without adding corner blocks', () => {
    const sim = mappedSim(palisadeMap());
    const terrain = terrainOf(sim);
    const layer = buildingBlockedLayer(sim.world, ctxOf(sim), terrain);
    const mask = walkBlockMask(sim.world, ctxOf(sim), terrain);
    const node = (x: number, y: number) => terrain.nodeAt(x, y);
    /** Settles the layer, then checks it and the mask against fresh derives. */
    const settled = (): void => {
      buildingBlockedLayer(sim.world, ctxOf(sim), terrain);
      expect(sim.world.verifyCaches()).toEqual([]);
      for (const cell of layer.cells) expect(mask.has(cell)).toBe(true);
    };
    const wallAt = (x: number, y: number, gfxIndex = WALL.typeId): Entity => {
      sim.enqueueSetup({ kind: 'placePalisade', gfxIndex, x, y, tribe: VIKING, underConstruction: false });
      sim.step();
      const placed = [...sim.world.query(Palisade)].sort((a, b) => b - a)[0];
      if (placed === undefined) throw new Error('the palisade stands');
      return placed;
    };

    // The navigation edge rule closes this joint without occupying either corner.
    wallAt(SEAL_WALL.x, SEAL_WALL.y);
    const partner = wallAt(SEAL_WALL.x - 1, SEAL_WALL.y + 1);
    settled();
    expect(mask.has(node(SEAL_WALL.x, SEAL_WALL.y))).toBe(true);
    expect(mask.has(node(ODD_CORNER.x, ODD_CORNER.y))).toBe(false);
    expect(mask.has(node(EVEN_CORNER.x, EVEN_CORNER.y))).toBe(false);

    // Adding a door must not occupy the other corner either.
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(ODD_CORNER.x + 1, ODD_CORNER.y));
    sim.world.add(hut, Building, { buildingType: HUT, tribe: VIKING, built: ONE, level: 0 });
    settled();
    expect(mask.has(node(ODD_CORNER.x, ODD_CORNER.y))).toBe(false);
    expect(mask.has(node(EVEN_CORNER.x, EVEN_CORNER.y))).toBe(false);

    sim.world.destroy(hut);
    settled();
    expect(mask.has(node(ODD_CORNER.x, ODD_CORNER.y))).toBe(false);
    expect(mask.has(node(EVEN_CORNER.x, EVEN_CORNER.y))).toBe(false);

    sim.world.destroy(partner);
    settled();
    expect(mask.has(node(ODD_CORNER.x, ODD_CORNER.y))).toBe(false);

    // A closed gate blocks its whole run; opened, it keeps only the outer posts.
    const gate = wallAt(GATE.x, GATE.y, CLOSED_GATE.typeId);
    settled();
    expect(mask.has(node(GATE.x, GATE.y))).toBe(true);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: true });
    sim.step();
    settled();
    expect(mask.has(node(GATE.x, GATE.y))).toBe(false);
    expect(mask.has(node(GATE.x + 2, GATE.y))).toBe(true);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    settled();
    expect(mask.has(node(GATE.x, GATE.y))).toBe(true);
  });
});

describe('building cells index', () => {
  it('re-stamps only the changed building and matches a fresh carve', () => {
    const { sim, home } = twoTierHome();
    const terrain = terrainOf(sim);
    const other = sim.world.create();
    sim.world.add(other, Position, positionOfNode(10, 10));
    sim.world.add(other, Building, { buildingType: HOME_S, tribe: VIKING, built: ONE, level: 0 });
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(10, 10))).toBe(true);
    sim.world.destroy(other);
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(10, 10))).toBe(false);
    sim.world.mut(home, Building).buildingType = HOME_L;
    buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags a building moved outside the tracked seams', () => {
    const { sim, home } = twoTierHome();
    buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    // Positions are immutable once placed; defeating that is the bug the verifier exists to catch.
    (sim.world.get(home, Position) as { x: Fixed }).x = positionOfNode(12, 12).x;
    expect(sim.world.verifyCaches().join('\n')).toContain('buildingCells');
  });
});

const HOME_S = 20; // 1-node body
const HOME_L = 21; // grows one node east
const STONE = 1;
const HALF = fx.div(ONE, fx.fromInt(2));

/** A level-0 home re-opened as an UPGRADE SITE (the command-driven model: `UnderConstruction` +
 *  `Upgrading` beside the Building) with the hammering done and the next tier's material delivered -
 *  one `constructionSystem` run finishes the upgrade in place. `growth` is the node only the larger
 *  tier walls off, `door` the larger tier's door, outside its body. */
function twoTierHome() {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME_S,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
        upgradeTarget: HOME_L,
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
      {
        typeId: HOME_L,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: STONE, amount: 1 }],
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
          ],
          door: { dx: 0, dy: 2 },
        },
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
  const home = sim.world.create();
  sim.world.add(home, Position, positionOfNode(5, 5));
  sim.world.add(home, Building, { buildingType: HOME_S, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  // The live stockpile is the site's build hold, holding the target tier's delivered bill.
  sim.world.add(home, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
  sim.world.add(home, UnderConstruction, { labor: ONE }); // hammering complete - only materials gate
  sim.world.add(home, Upgrading, {
    target: HOME_L,
    savedStock: new Map<number, number>(),
    seeded: new Map<number, number>(),
  });
  return { sim, home, growth: terrainOf(sim).nodeAt(6, 5), door: terrainOf(sim).nodeAt(5, 7) };
}

/** A wall on an even row: its slanted joint partner stands one row down and one node west. */
const SEAL_WALL = { x: 8, y: 8 };
/** The two open corners beside the slanted wall joint. */
const ODD_CORNER = { x: 8, y: 9 };
const EVEN_CORNER = { x: 7, y: 8 };
const GATE = { x: 20, y: 20 };

const WALL_STATS = { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: STONE, amount: 1 }] };
const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: WALL_STATS,
};
const GATE_RUN = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
const CLOSED_GATE: ScriptLandscapeType = {
  typeId: 696,
  walk: GATE_RUN,
  build: GATE_RUN,
  groups: [],
  wall: { ...WALL_STATS, gate: { open: false, counterpartGfxIndex: 700 } },
};
const OPEN_GATE: ScriptLandscapeType = {
  typeId: 700,
  walk: [
    { dx: -2, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  build: GATE_RUN,
  groups: [],
  wall: { ...WALL_STATS, gate: { open: true, counterpartGfxIndex: 696 } },
};

function palisadeMap() {
  return { ...grassNodeMap(32, 32), landscapes: { types: [WALL, CLOSED_GATE, OPEN_GATE], placements: [] } };
}
