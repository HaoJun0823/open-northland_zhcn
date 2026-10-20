import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MISSION_BEHAVIOUR,
  ORDER_QUEUE_LIMIT,
  Owner,
  Position,
  seatPassenger,
  setMissionBehaviour,
  setNeedsEnabled,
  stampOwner,
  unseatPassenger,
  Vehicle,
  VehicleDrive,
  VehicleOrderQueue,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  ONE,
  type PlayerCommand,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { vehicleAnchor } from '../../src/systems/footprint/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/** Shift-clicked drives wait behind the vehicle's current order and start once it arrives. */

const CATAPULT = 5;
const VIKING = 1;
const CREW_JOB = 31;
const HUMAN_PLAYER = 0;
const MAP = { width: 120, height: 60 };
const DRIVE_BUDGET = 3000;
const START = { hx: 8, hy: 8 };
const FIRST = { hx: 40, hy: 8 };
const SECOND = { hx: 40, hy: 30 };

function freshSim(): Simulation {
  const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(MAP.width, MAP.height) });
  setNeedsEnabled(sim.world, false);
  return sim;
}

function person(sim: Simulation): Entity {
  const e = sim.world.create();
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: CREW_JOB,
    hunger: ONE,
    fatigue: ONE,
    piety: ONE,
    enjoyment: ONE,
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  sim.world.add(e, Position, positionOfNode(START.hx, START.hy));
  return e;
}

/** A catapult with its commander aboard. */
function catapult(sim: Simulation): { vehicle: Entity; commander: Entity } {
  const vehicle = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: CATAPULT,
    tribe: VIKING,
    x: START.hx,
    y: START.hy,
    owner: HUMAN_PLAYER,
  });
  if (vehicle === null) throw new Error('missing catapult');
  const commander = person(sim);
  if (!seatPassenger(sim.world, vehicle, commander)) throw new Error('no commander seat');
  boardRider(sim.world, commander, vehicle);
  return { vehicle, commander };
}

function drive(vehicle: Entity, to: { hx: number; hy: number }, queued = false): PlayerCommand {
  return { kind: 'moveVehicle', vehicle, x: to.hx, y: to.hy, ...(queued ? { queued } : {}) };
}

function isAt(sim: Simulation, vehicle: Entity, at: { hx: number; hy: number }): boolean {
  const anchor = vehicleAnchor(sim.world, vehicle);
  return anchor?.hx === at.hx && anchor.hy === at.hy;
}

function standsAt(sim: Simulation, vehicle: Entity, at: { hx: number; hy: number }): boolean {
  return isAt(sim, vehicle, at) && !sim.world.has(vehicle, VehicleDrive);
}

function stepUntil(sim: Simulation, done: () => boolean): void {
  for (let t = 0; t < DRIVE_BUDGET && !done(); t++) sim.step();
}

describe('vehicle order queue', () => {
  it('a queued drive on an idle vehicle applies at once', () => {
    const sim = freshSim();
    const { vehicle } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST, true)));
    sim.step();
    expect(sim.world.has(vehicle, VehicleDrive)).toBe(true);
    expect(sim.world.has(vehicle, VehicleOrderQueue)).toBe(false);
  });

  it('drives the queued waypoints in order, the queue surviving a save', () => {
    const sim = freshSim();
    const { vehicle } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    sim.step();
    expect(sim.world.get(vehicle, VehicleOrderQueue).orders).toHaveLength(1);
    const copy = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: testContent(),
      map: grassNodeMap(MAP.width, MAP.height),
    });
    let reachedFirst = false;
    stepUntil(sim, () => {
      reachedFirst ||= isAt(sim, vehicle, FIRST);
      return standsAt(sim, vehicle, SECOND);
    });
    expect(reachedFirst).toBe(true);
    expect(standsAt(sim, vehicle, SECOND)).toBe(true);
    expect(sim.world.has(vehicle, VehicleOrderQueue)).toBe(false);
    copy.run(sim.tick - copy.tick);
    expect(copy.hashState()).toBe(sim.hashState());
  });

  it("a commander's queued walk and a queued group drive line up on the vehicle", () => {
    const sim = freshSim();
    const { vehicle, commander } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, {
        kind: 'attackMoveUnit',
        entity: commander,
        x: SECOND.hx,
        y: SECOND.hy,
        queued: true,
      }),
    );
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, {
        kind: 'moveVehicleGroup',
        members: [{ entity: vehicle, x: START.hx, y: START.hy }],
        queued: true,
      }),
    );
    sim.step();
    expect(sim.world.get(vehicle, VehicleOrderQueue).orders).toEqual([
      { kind: 'moveVehicle', vehicle, x: SECOND.hx, y: SECOND.hy, attackMove: true },
      { kind: 'moveVehicle', vehicle, x: START.hx, y: START.hy },
    ]);
    stepUntil(sim, () => sim.world.get(vehicle, Vehicle).march !== null);
    expect(isAt(sim, vehicle, FIRST)).toBe(true); // the march starts where the drive ahead arrived
  });

  it('an unqueued order, or a vehicle left without its commander, drops the queue', () => {
    const sim = freshSim();
    const stopped = catapult(sim).vehicle;
    const abandoned = catapult(sim);
    for (const vehicle of [stopped, abandoned.vehicle]) {
      sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
      sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    }
    sim.step();
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'stopVehicle', vehicle: stopped }));
    unseatPassenger(sim.world, abandoned.vehicle, abandoned.commander);
    sim.step();
    expect(sim.world.has(stopped, VehicleOrderQueue)).toBe(false);
    expect(sim.world.has(abandoned.vehicle, VehicleOrderQueue)).toBe(false);
  });

  it('starts the next drive on the arrival tick, so the vehicle never stands idle between two legs', () => {
    const sim = freshSim();
    const { vehicle } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    for (let t = 0; t < DRIVE_BUDGET && !standsAt(sim, vehicle, SECOND); t++) {
      sim.step();
      if (!sim.world.has(vehicle, VehicleOrderQueue)) continue;
      const busy = sim.world.has(vehicle, VehicleDrive) || sim.world.get(vehicle, Vehicle).heldGoal !== null;
      expect(busy).toBe(true);
    }
    expect(standsAt(sim, vehicle, SECOND)).toBe(true);
  });

  it('a Shift drive to a busy vehicle nobody commands is refused as a plain drive is', () => {
    const sim = freshSim();
    const { vehicle, commander } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    sim.step();
    unseatPassenger(sim.world, vehicle, commander); // the leg under way goes on
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    sim.step();
    expect(sim.world.has(vehicle, VehicleOrderQueue)).toBe(false);
    expect(
      sim.events.current().some((ev) => ev.kind === 'vehicleMoveRefused' && ev.reason === 'noCommander'),
    ).toBe(true);
  });

  it('a vehicle handed to another player, or taken by a script, drops the drives queued for it', () => {
    const sim = freshSim();
    const handed = catapult(sim).vehicle;
    const scripted = catapult(sim).vehicle;
    for (const vehicle of [handed, scripted]) {
      sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
      sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    }
    sim.step();
    stampOwner(sim.world, handed, HUMAN_PLAYER + 1);
    setMissionBehaviour(sim.world, scripted, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
    sim.step();
    expect(sim.world.has(handed, VehicleOrderQueue)).toBe(false);
    expect(sim.world.has(scripted, VehicleOrderQueue)).toBe(false);
  });

  it('skips a queued drive refused at its start for the next one', () => {
    const sim = freshSim();
    const { vehicle } = catapult(sim);
    const OFF_MAP = { hx: 10 * MAP.width, hy: 10 * MAP.height };
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, OFF_MAP, true)));
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, SECOND, true)));
    let refused = false;
    stepUntil(sim, () => {
      refused ||= sim.events
        .current()
        .some((ev) => ev.kind === 'vehicleMoveRefused' && ev.reason === 'noPath');
      return standsAt(sim, vehicle, SECOND);
    });
    expect(refused).toBe(true);
    expect(standsAt(sim, vehicle, SECOND)).toBe(true);
  });

  it(`keeps at most ${ORDER_QUEUE_LIMIT} waiting drives`, () => {
    const sim = freshSim();
    const { vehicle } = catapult(sim);
    sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, FIRST)));
    for (let i = 0; i <= ORDER_QUEUE_LIMIT; i++)
      sim.enqueue(playerCommand(HUMAN_PLAYER, drive(vehicle, { hx: 10 + 2 * i, hy: 20 }, true)));
    sim.step();
    expect(sim.world.get(vehicle, VehicleOrderQueue).orders).toHaveLength(ORDER_QUEUE_LIMIT);
  });
});
