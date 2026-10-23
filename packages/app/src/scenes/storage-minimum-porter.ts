import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_WELL,
  dropSandboxGood,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { buildingOfType, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The storage minimum and the headquarters porter: the player keeps water in storage, so the porter
 * fetches it from the unstaffed well across the meadow before it brings in the stone heap at its door.
 */

const MAP_W = 30;
const MAP_H = 14;
const HQ_AT = { x: 6, y: 7 } as const;
const STONE_AT = { x: 3, y: 12 } as const;
const WELL_AT = { x: 20, y: 7 } as const;
const STONE_DROPPED = 3;
const WATER_MINIMUM = 3;
const RUN_TICKS = 6000;

const { Building, Position, Stockpile } = components;

function headquartersStock(sim: Simulation, slug: string): number {
  const hq = buildingOfType(sim, BUILDING_HEADQUARTERS);
  return hq === null ? 0 : (sim.world.get(hq, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0);
}

function looseUnits(sim: Simulation, slug: string): number {
  const good = goodBySlug(sim, slug);
  let units = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!sim.world.has(e, Building)) units += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return units;
}

function build(sim: Simulation): void {
  const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y);
  placeBuiltSandboxBuilding(sim, BUILDING_WELL, WELL_AT.x, WELL_AT.y);
  spawnWorkersAtDoor(sim, hq, 1, { jobType: JOB_CARRIER });
  dropSandboxGood(sim, goodBySlug(sim, 'stone'), STONE_AT.x, STONE_AT.y, STONE_DROPPED);
  sim.enqueueSetup({
    kind: 'setStorageMinimum',
    player: HUMAN_PLAYER,
    goodType: goodBySlug(sim, 'water'),
    amount: WATER_MINIMUM,
  });
}

export const storageMinimumPorterScene: SceneDefinition = {
  id: 'storage-minimum-porter',
  seed: 24,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  needs: false,
  progression: false,
  checks: [
    {
      label: 'the headquarters holds the water minimum',
      predicate: (sim) => headquartersStock(sim, 'water') >= WATER_MINIMUM,
    },
    {
      label: 'the stone heap reached the headquarters',
      predicate: (sim) => looseUnits(sim, 'stone') === 0,
    },
  ],
};
