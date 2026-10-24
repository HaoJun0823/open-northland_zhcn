import { components, type Entity, playerCommand, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CARRIER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  assignmentPriority,
  BUILDING_WAREHOUSE_00,
  buildingDef,
  dropSandboxGood,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
} from '../../game/sandbox/index.js';
import { goodBySlug, storedInBuildings } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * Two porters of a warehouse and their hauling carts (`HaulingCart`): each is handed a cart standing a
 * few cells west and takes it at its door, then clears the wood piles to the north pile by pile, a whole
 * pile a trip instead of a unit. The browser view is the check that a porter pulling its cart draws as
 * the cart's driving figure, handcart and ox cart alike, walking and standing, and that the cart itself
 * is gone from where it stood. The handcart porter is sent to bed mid-haul, so the view also shows a cart
 * parked for a break and taken up again after it.
 */

const MAP_W = 24;
const MAP_H = 16;
const WAREHOUSE = { x: 13, y: 8 } as const;
const HANDCART = { x: 5, y: 6 } as const;
const OXCART = { x: 5, y: 10 } as const;
/** The porters stand two cells east of their carts. */
const PORTER_OFFSET_X = 2;
const WOOD_PILES: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 8, y: 3 },
  { x: 10, y: 3 },
  { x: 12, y: 3 },
  { x: 14, y: 3 },
];
/** A ground pile's full stack, so one pile is one cart lift. */
const PILE_UNITS = 5;
/** The tick the attach orders enter, after the setup pass has posted the porters. */
const ATTACH_TICK = 2;
/** The tick the handcart porter is sent to bed mid-haul: it parks the cart, sleeps and takes it up again. */
export const SLEEP_ORDER_TICK = 300;
/** Ticks after the sleep order by which the cart stands parked and the porter is off to bed; it takes
 *  the cart up again after tick 550 on seed 11. */
export const PARKED_CHECK_TICKS = 100;
/** Claims positions no session transport hands out for that tick. */
const ATTACH_SEQUENCE = 1_000_000;
/** Headroom over the measured run: seed 11 has both carts taken by tick 120 and the piles cleared, a
 *  clip a unit each way and the sleep included, by tick 1600. */
const RUN_TICKS = 2_400;

const { HaulingCart } = components;

/** A porter posted to `warehouse` beside a cart of `type` at `at`, the cart handed to it on tick two. */
function porterWithCart(
  sim: Simulation,
  warehouse: Entity,
  type: number,
  at: { readonly x: number; readonly y: number },
  sequence: number,
): Entity {
  const cart = spawnVehicleDirect(sim, type, at.x, at.y);
  const porter = spawnSettlerDirect(sim, JOB_CARRIER, at.x + PORTER_OFFSET_X, at.y, HUMAN_PLAYER);
  const jobPriority = assignmentPriority(buildingDef(sim, BUILDING_WAREHOUSE_00)?.workers);
  sim.enqueueSetup({ kind: 'assignWorker', entity: porter, building: warehouse, jobPriority });
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: porter, vehicle: cart }),
    ATTACH_TICK,
    sequence,
  );
  return porter;
}

function build(sim: Simulation): void {
  const wood = goodBySlug(sim, 'wood');
  const warehouse = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
  for (const pile of WOOD_PILES) dropSandboxGood(sim, wood, pile.x, pile.y, PILE_UNITS);
  // The runtime turns progression off only after the build, too late for the tick-0 posting.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  const sleeper = porterWithCart(sim, warehouse, VEHICLE_HANDCART, HANDCART, ATTACH_SEQUENCE);
  porterWithCart(sim, warehouse, VEHICLE_OXCART, OXCART, ATTACH_SEQUENCE + 1);
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'orderNeed', entity: sleeper, need: 'fatigue' }),
    SLEEP_ORDER_TICK,
    ATTACH_SEQUENCE,
  );
}

export const haulingCartScene: SceneDefinition = {
  id: 'hauling-cart',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'both porters have taken their carts off the map and still pull them',
      predicate: (sim) =>
        sim.vehiclesOf(HUMAN_PLAYER).every((v) => v.hauler !== null && v.at === null) &&
        [...sim.world.query(HaulingCart)].every((e) => sim.world.get(e, HaulingCart).taken),
    },
    {
      label: 'the wood piles were cleared into the warehouse',
      predicate: (sim) => storedInBuildings(sim, goodBySlug(sim, 'wood')) === WOOD_PILES.length * PILE_UNITS,
    },
  ],
};
