import type { Simulation } from '@open-northland/sim';
import { components, ONE, upgradeBillForType } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_BUILDER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_HOME_04,
  BUILDING_JOINERY,
  BUILDING_WAREHOUSE_00,
  buildingDef,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../../game/sandbox/index.js';
import { buildingOfType } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Building, Stockpile } = components;

const MAP_W = 30;
const MAP_H = 18;
const HQ = { x: 6, y: 7 } as const;
/** Ordered straight to the top tier at build time. */
const JUMPED_HOME = { x: 12, y: 6 } as const;
/** Left at their first tier for the Upgrade tile's level choice in the browser. */
const BUTTON_HOME = { x: 17, y: 6 } as const;
const BUTTON_WAREHOUSE = { x: 17, y: 12 } as const;
const BUTTON_JOINERY = { x: 23, y: 9 } as const;
const BUILDERS = [
  { x: 10, y: 9 },
  { x: 11, y: 10 },
] as const;
/** Four tiers' bills hauled and hammered in one site, measured under 20k ticks; the rest is slack. */
const RUN_TICKS = 30_000;

function build(sim: Simulation): void {
  // Precedes the upgrade command so real content's tier gate admits it; technology has its own scene.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  for (const at of BUILDERS) spawnSandboxSettler(sim, JOB_BUILDER, at.x, at.y, HUMAN_PLAYER);
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, JUMPED_HOME.x, JUMPED_HOME.y, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, BUTTON_HOME.x, BUTTON_HOME.y, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, BUTTON_WAREHOUSE.x, BUTTON_WAREHOUSE.y, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_JOINERY, BUTTON_JOINERY.x, BUTTON_JOINERY.y, HUMAN_PLAYER);
  sim.enqueueSetup({ kind: 'upgradeBuilding', building: home, target: BUILDING_HOME_04 });
}

/** Derived as the gap from the HQ's filled capacity, which only the upgrade draws on here. */
function hqDrawnGoods(sim: Simulation): Map<number, number> {
  const drawn = new Map<number, number>();
  const hq = buildingOfType(sim, BUILDING_HEADQUARTERS);
  if (hq === null) return drawn;
  const amounts = sim.world.get(hq, Stockpile).amounts;
  for (const slot of buildingDef(sim, BUILDING_HEADQUARTERS)?.stock ?? []) {
    const missing = slot.capacity - (amounts.get(slot.goodType) ?? 0);
    if (missing > 0) drawn.set(slot.goodType, missing);
  }
  return drawn;
}

/** A home ordered from its first tier to its top in one site, beside untouched first tiers of every
 *  chain longer than one step. */
export const upgradeLevelsScene: SceneDefinition = {
  id: 'upgrade-levels',
  seed: 6,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  stages: [{ id: 'upgrade-levels', focus: { x: 15, y: 9 }, zoom: 1, actions: [] }],
  checks: [
    {
      label: 'the jumped home stands finished at the top tier, level 5',
      predicate: (sim) => {
        const e = buildingOfType(sim, BUILDING_HOME_04);
        if (e === null) return false;
        const b = sim.world.get(e, Building);
        return b.level === 4 && b.built >= ONE;
      },
    },
    {
      label: 'the HQ paid every raised tier once - the merged bill of levels 2 to 5',
      predicate: (sim) => {
        const bill = upgradeBillForType(sim.content.buildings, BUILDING_HOME_00, BUILDING_HOME_04);
        const drawn = hqDrawnGoods(sim);
        if (bill.length === 0 || drawn.size !== bill.length) return false;
        return bill.every((line) => drawn.get(line.goodType) === line.amount);
      },
    },
  ],
};
