import type { TerrainMapFile } from '@open-northland/data';
import { components, Simulation, systems, type TerrainMap } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { WOOD_YIELD_PER_NODE } from '../../../src/catalog/felling.js';
import { JOB_COLLECTOR } from '../../../src/catalog/jobs.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildScriptLandscapeTerrain } from '../../../src/content/map/script-landscape.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../src/game/rules.js';
import { sandboxContent } from '../../../src/game/sandbox/content/index.js';
import { GOOD_WOOD } from '../../../src/game/sandbox/ids/index.js';

/**
 * The map gathering cycle over the content `?map=` runs (`sandboxContent`, footprinted trees) and a
 * collision grid built by the real map join (`buildScriptLandscapeTerrain`): a command-spawned wood
 * gatherer in a dense tree cluster must fell, pick up the trunk and bank it at its flag. A harvestable
 * baked into the static grid would never unblock when it falls, leaving the trunk unreachable.
 */

const { GroundDrop, Stockpile } = components;

/** A footprinted map-style tree (the exact spec `spawnMapResources` builds) at half-cell (hx, hy). */
function mapTree(sim: Simulation, hx: number, hy: number): void {
  const e = systems.createResourceNode(sim.world, sim.content, {
    good: GOOD_WOOD,
    x: hx,
    y: hy,
    remaining: WOOD_YIELD_PER_NODE,
    harvestAtomic: sandboxContent().goods.find((g) => g.id === 'wood')?.atomics.harvest ?? 24,
    felling: true,
  });
  expect(e).not.toBeNull();
}

/** Total wood lying in loose ground drops (an unfinished cycle leaves the trunk here). */
function looseWood(sim: Simulation): number {
  let sum = 0;
  for (const e of sim.world.query(GroundDrop, Stockpile)) {
    sum += sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0;
  }
  return sum;
}

/** Total wood banked in NON-drop stockpiles (the flag-side heaps a finished cycle produces). */
function bankedWood(sim: Simulation): number {
  let sum = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, GroundDrop)) continue;
    sum += sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0;
  }
  return sum;
}

describe('map-style gathering cycle (sandbox content, footprinted trees, dense forest)', () => {
  it('completes the cycle over the REAL collision join - a felled tree must unblock its cell', () => {
    // A synthetic decoded-map file: 40×40 open ground, a 5×5 tree cluster in the objects lane (the
    // lane the STATIC collision join stamps) - the exact shape the live map stalls on.
    const treeName = 'cycle tree';
    const placements: number[] = [];
    for (let hy = 34; hy <= 42; hy += 2) {
      for (let hx = 44; hx <= 52; hx += 2) placements.push(hx, hy, 0);
    }
    const mapFile: TerrainMapFile = {
      width: 40,
      height: 40,
      typeIds: new Array(40 * 40).fill(0),
      objects: { types: [treeName], placements },
    };
    // The collision view: the tree blocks its own node (walk) - enough to reproduce the wall.
    const ir: ContentIr = {
      landscapeGfx: [{ index: 900, editName: treeName, logicType: 4, walkBlockAreas: [[1, 0, 0, 1]] }],
      gatheringPipeline: [{ goodType: 5, goodId: 'wood', harvest: { landscapeType: 4, gfxIndices: [900] } }],
    };
    // The map join under test: a harvestable placement stays out of the static grid (its blocking is
    // the dynamic resource footprint, unstamped on fell). Were it baked in, the felled tree's cell would
    // stay TERRAIN_BLOCKED forever and the trunk lying there unreachable - the reported stall.
    const grid: TerrainMap = buildScriptLandscapeTerrain(mapFile, ir);
    const sim = new Simulation({ seed: 12, content: sandboxContent(), map: grid });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: JOB_COLLECTOR,
      x: 40,
      y: 40,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
    sim.step();
    // The same trees as REAL entities (what spawnMapResources does for these placements).
    for (let hy = 34; hy <= 42; hy += 2) {
      for (let hx = 44; hx <= 52; hx += 2) mapTree(sim, hx, hy);
    }

    for (let t = 0; t < 3000; t++) sim.step();

    expect(bankedWood(sim)).toBeGreaterThan(0); // the full fell → pick up → bank loop completed
    expect(looseWood(sim)).toBeLessThanOrEqual(WOOD_YIELD_PER_NODE); // no abandoned log
  });
});
