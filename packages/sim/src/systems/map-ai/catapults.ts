import {
  type MapAiSoldierRecord,
  Vehicle,
  VehicleDrive,
  type VehicleStateView,
  vehicleCommander,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import { seatCatapults } from '../ai-shared/military/catapults.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { canAttachToVehicle } from '../vehicles/crew.js';
import { crewInside } from '../vehicles/movement.js';

// The seat's catapults, as the scripted handler keeps its vehicles (`docs/formats/MISSIONS.md`, AI data):
// a listed man crews each one without a commander, and a crewed one guards its own spot.

/** How far, in map points, from a commanderless catapult the handler looks for a man to crew it.
 *  Original behavior. */
export const CREW_REACH_POINTS = 20;

/** How far, in map points, an idle catapult may stand off its guard spot before the handler drives it
 *  back (authored: past the step a back-off or a parking shift beside another vehicle takes). */
export const GUARD_SLACK_POINTS = 4;

export interface CatapultDecision {
  readonly commands: readonly PlayerCommand[];
  /** Men attached this turn. The attach applies next tick, so no other order may take them now. */
  readonly drafted: ReadonlySet<Entity>;
}

/**
 * One turn for the seat's catapults: each one without a commander takes the nearest listed man within
 * {@link CREW_REACH_POINTS} who may crew it, the lowest id on a tie, and that man leaves `soldiers`. A
 * commanded catapult holds the defence stance, whose scan answers an enemy around its guard spot, and
 * one left idle off that spot after a fight drives back to it.
 */
export function catapultOrders(
  world: World,
  ctx: SystemContext,
  seat: number,
  soldiers: MapAiSoldierRecord[],
): CatapultDecision {
  const commands: PlayerCommand[] = [];
  const drafted = new Set<Entity>();
  for (const vehicle of seatCatapults(world, ctx, seat)) {
    const state = world.get(vehicle, Vehicle);
    const at = vehicleAnchor(world, vehicle);
    if (at === null) continue;
    if (vehicleCommander(state) === null) {
      const driver = nearestCrew(world, ctx, vehicle, at, soldiers, drafted);
      if (driver === null) continue;
      drafted.add(driver);
      commands.push({ kind: 'attachToVehicle', entity: driver, vehicle });
    }
    if (state.stance !== 'defence') {
      commands.push({ kind: 'setVehicleStance', vehicle, stance: 'defence' });
      continue;
    }
    if (
      state.guard !== null &&
      idleAboard(world, vehicle, state) &&
      hexDistance(at, state.guard) > GUARD_SLACK_POINTS
    ) {
      commands.push({ kind: 'moveVehicle', vehicle, x: state.guard.hx, y: state.guard.hy });
    }
  }
  if (drafted.size > 0) {
    const kept = soldiers.filter((record) => !drafted.has(record.entity));
    soldiers.length = 0;
    soldiers.push(...kept);
  }
  return { commands, drafted };
}

function nearestCrew(
  world: World,
  ctx: SystemContext,
  vehicle: Entity,
  at: HalfCellNode,
  soldiers: readonly MapAiSoldierRecord[],
  drafted: ReadonlySet<Entity>,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = CREW_REACH_POINTS + 1;
  for (const { entity } of soldiers) {
    if (drafted.has(entity)) continue;
    const node = anchorNodeOf(world, entity);
    if (node === null) continue;
    const distance = hexDistance(node, at);
    if (distance >= bestDistance || !canAttachToVehicle(world, ctx, entity, vehicle)) continue;
    best = entity;
    bestDistance = distance;
  }
  return best;
}

/** Whether the crewed catapult stands with its crew aboard and nothing to do: no fight, march or drive. */
function idleAboard(world: World, vehicle: Entity, state: VehicleStateView): boolean {
  return (
    crewInside(state) &&
    state.attack === null &&
    state.march === null &&
    state.heldGoal === null &&
    !world.has(vehicle, VehicleDrive)
  );
}
