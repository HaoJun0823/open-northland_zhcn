import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { buildingOfType, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The storage minimum: the player keeps water in storage, so the well's carrier fills the warehouse up
 * to the minimum before it feeds the bakery again, and the baker never takes the warehouse's water
 * below it. The browser view opens the warehouse or the well to set the minimum with −/+.
 */

const MAP_W = 30;
const MAP_H = 14;
const WAREHOUSE_AT = { x: 6, y: 7 } as const;
const WELL_AT = { x: 15, y: 7 } as const;
const BAKERY_AT = { x: 24, y: 7 } as const;

/** The water the warehouses keep, and the flour the bakery starts with so only water limits it. */
const WATER_MINIMUM = 10;
const FLOUR_STOCKED = 20;
const RUN_TICKS = 9000;

const { Stockpile, setStockAmount } = components;

function stockAt(sim: Simulation, buildingType: number, slug: string): number {
  const building = buildingOfType(sim, buildingType);
  return building === null ? 0 : (sim.world.get(building, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0);
}

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_AT.x, WAREHOUSE_AT.y);
  const well = placeBuiltSandboxBuilding(sim, BUILDING_WELL, WELL_AT.x, WELL_AT.y);
  const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, BAKERY_AT.x, BAKERY_AT.y);
  setStockAmount(sim.world, bakery, goodBySlug(sim, 'flour'), FLOUR_STOCKED);
  spawnWorkersAtDoor(sim, well, 1);
  spawnWorkersAtDoor(sim, bakery, 1);
  sim.enqueueSetup({
    kind: 'setStorageMinimum',
    player: HUMAN_PLAYER,
    goodType: goodBySlug(sim, 'water'),
    amount: WATER_MINIMUM,
  });
}

export const storageMinimumScene: SceneDefinition = {
  id: 'storage-minimum',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  needs: false,
  progression: false,
  checks: [
    {
      label: 'the warehouse holds the water minimum',
      predicate: (sim) => stockAt(sim, BUILDING_WAREHOUSE_00, 'water') >= WATER_MINIMUM,
    },
    {
      label: 'the bakery baked bread once the minimum was met',
      predicate: (sim) => stockAt(sim, BUILDING_BAKERY, 'bread') > 0,
    },
  ],
};
