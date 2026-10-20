import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const HEADQUARTERS = { x: 24, y: 10 } as const;
const HOME = { x: 24, y: 18 } as const;
const BAKERY = { x: 12, y: 10 } as const;
/** The collector who unlocks the bakery's trade. */
const COLLECTOR = { x: 2, y: 2 } as const;

function headquartersOf(sim: Simulation): Entity | undefined {
  return [...sim.world.query(components.Building)].find(
    (e) => sim.world.get(e, components.Building).buildingType === BUILDING_HEADQUARTERS,
  );
}

/** The bakery's product, read off the content the scene runs on: the fallback and the real goods differ. */
function breadOf(sim: Simulation): number | undefined {
  return sim.content.buildings.find((b) => b.typeId === BUILDING_BAKERY)?.produces[0];
}

/** Whether the headquarters' slot for the food bread is banked as is still full. */
function breadSlotFull(sim: Simulation): boolean {
  const headquarters = headquartersOf(sim);
  const bread = breadOf(sim);
  if (headquarters === undefined || bread === undefined) return false;
  const food = systems.edibleGoodFormOf(sim.content, bread);
  const slot = sim.content.buildings
    .find((b) => b.typeId === BUILDING_HEADQUARTERS)
    ?.stock.find((s) => s.goodType === food);
  const held = sim.world.get(headquarters, components.Stockpile).amounts.get(food) ?? 0;
  return slot !== undefined && held >= slot.capacity;
}

/** Stock every slot of `building`, a built `type`, to its capacity. */
function fillEverySlot(sim: Simulation, building: Entity, type: number): void {
  const slots = sim.content.buildings.find((b) => b.typeId === type)?.stock ?? [];
  const stock = sim.world.mut(building, components.Stockpile).amounts;
  for (const slot of slots) stock.set(slot.goodType, slot.capacity);
}

/** A headquarters and a home with every slot full beside a staffed bakery whose bread shelf is full, so
 *  the baker has nowhere to take bread and cannot bake. */
export const storageFullScene: SceneDefinition = {
  id: 'storage-full',
  seed: 7,
  terrain: grassTerrain(40, 24),
  initialZoom: 0.9,
  progression: false,
  build: (sim) => {
    spawnSandboxSettler(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y);
    const headquarters = placeBuiltSandboxBuilding(
      sim,
      BUILDING_HEADQUARTERS,
      HEADQUARTERS.x,
      HEADQUARTERS.y,
    );
    fillEverySlot(sim, headquarters, BUILDING_HEADQUARTERS);
    const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, HOME.x, HOME.y);
    fillEverySlot(sim, home, BUILDING_HOME_00);
    const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, BAKERY.x, BAKERY.y);
    const bread = breadOf(sim);
    const breadSlot = sim.content.buildings
      .find((b) => b.typeId === BUILDING_BAKERY)
      ?.stock.find((s) => s.goodType === bread);
    if (breadSlot !== undefined) {
      sim.world.mut(bakery, components.Stockpile).amounts.set(breadSlot.goodType, breadSlot.capacity);
    }
    spawnWorkersAtDoor(sim, bakery, 1);
  },
  runTicks: 120,
  checks: [
    {
      label: 'the headquarters stays full of the food bread is stored as',
      predicate: breadSlotFull,
    },
  ],
};
