import {
  cellAnchorNode,
  cellOfNode,
  components,
  constructionBillForType,
  type Entity,
  fx,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CARRIER, JOB_TRADER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_CATAPULT_YARD,
  placeSandboxSite,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
} from '../../game/sandbox/index.js';
import { CIVILIZATIONS } from '../civilizations.js';
import type { SceneDefinition } from '../types.js';

const { Building, Health, Settler, Stockpile, UnderConstruction, WALK_DIRECTION } = components;

/** Each row's two carts, their commander one cell behind, each driving east to its own goal. */
const DRIVES = [
  { type: VEHICLE_HANDCART, commander: JOB_TRADER, fromX: 3, toX: 7 },
  { type: VEHICLE_OXCART, commander: JOB_CARRIER, fromX: 10, toX: 15 },
] as const;
const COMMANDER_OFFSET_X = -1;
/** Each row ends in its civilization's catapult yard, part built: a site draws its frame revealed up
 *  to its progress, and nobody here works on it. */
const YARD_X = 19;
const YARD_BUILT = fx.fromFloat(0.7);
const MARGIN_Y = 3;
const SPACING_Y = 3;
const MAP_W = 22;
const MAP_H = MARGIN_Y * 2 + SPACING_Y * CIVILIZATIONS.length;
/** Ticks before the drive orders, so each cart rolls only once its commander is aboard. */
const DRIVE_ORDER_TICK = 6;
/** Claims positions no session transport hands out for that tick. */
const DRIVE_SEQUENCE = 1_000_000;

function build(sim: Simulation): void {
  let sequence = DRIVE_SEQUENCE;
  for (const [row, tribe] of CIVILIZATIONS.entries()) {
    const y = MARGIN_Y + row * SPACING_Y;
    const yard = placeSandboxSite(sim, BUILDING_CATAPULT_YARD, YARD_X, y, HUMAN_PLAYER, { tribe });
    const building = sim.world.mut(yard, Building);
    building.built = YARD_BUILT;
    sim.world.mut(yard, UnderConstruction).labor = YARD_BUILT;
    const health = sim.world.mut(yard, Health);
    health.hitpoints = health.max;
    // Progress holds only over delivered material, so the site's bill lies in its hold.
    const hold = sim.world.mut(yard, Stockpile).amounts;
    for (const line of constructionBillForType(sim.content.buildings, BUILDING_CATAPULT_YARD))
      hold.set(line.goodType, line.amount);
    for (const drive of DRIVES) {
      const vehicle = spawnVehicleDirect(sim, drive.type, drive.fromX, y, {
        tribe,
        owner: HUMAN_PLAYER,
        facing: WALK_DIRECTION.E,
      });
      const node = cellAnchorNode(drive.fromX + COMMANDER_OFFSET_X, y);
      const commander: Entity | null = systems.createSettler(
        sim.world,
        sim.content,
        sim.rng,
        { tribe, jobType: drive.commander, owner: HUMAN_PLAYER, x: node.hx, y: node.hy },
        sim.names,
      );
      if (commander === null) throw new Error('cart-drivers: missing commander job');
      sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle }));
      const goal = cellAnchorNode(drive.toX, y);
      sim.enqueueAt(
        playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: goal.hx, y: goal.hy }),
        DRIVE_ORDER_TICK,
        sequence++,
      );
    }
  }
}

/** Every cart carries its own civilization's commander inside and has rolled east off its spawn node. */
function everyCartDrivenByItsTribe(sim: Simulation): boolean {
  const views = sim.vehiclesOf(HUMAN_PLAYER);
  return (
    views.length === CIVILIZATIONS.length * DRIVES.length &&
    views.every((view) => {
      const drive = DRIVES.find((d) => d.type === view.vehicleType);
      const rider = view.passengers[0];
      return (
        drive !== undefined &&
        rider?.inside === true &&
        sim.world.get(rider.entity, Settler).tribe === view.tribe &&
        view.at !== null &&
        // Each cart keeps its row, whose stagger moves its spawn node half a cell on the odd rows.
        view.at.hx > cellAnchorNode(drive.fromX, cellOfNode(view.at.hx, view.at.hy).cy).hx
      );
    })
  );
}

/** One unfinished catapult yard stands per civilization. */
function yardPerTribe(sim: Simulation): boolean {
  const tribes = new Set<number>();
  for (const e of sim.world.query(Building, UnderConstruction)) {
    const building = sim.world.get(e, Building);
    if (building.buildingType === BUILDING_CATAPULT_YARD) tribes.add(building.tribe);
  }
  return CIVILIZATIONS.every((tribe) => tribes.has(tribe));
}

/**
 * A trader driving a handcart and a carrier driving an ox cart for each civilization, in rows: viking,
 * frank, byzantine, saracen, egyptian. The browser view is the check that every driver wears his own
 * civilization's head, standing and driving, that every cart's wheels turn, and that each row's
 * catapult yard draws a catapult, not a cart.
 */
export const cartDriversScene: SceneDefinition = {
  id: 'cart-drivers',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: CIVILIZATIONS,
  initialZoom: 0.95,
  runTicks: 200,
  checks: [
    {
      label: "every cart is driven east by its own civilization's commander",
      predicate: everyCartDrivenByItsTribe,
    },
    { label: 'every civilization has its catapult yard under construction', predicate: yardPerTribe },
  ],
};
