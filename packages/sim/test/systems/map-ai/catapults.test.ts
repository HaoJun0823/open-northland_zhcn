import { type ContentSet, type MapAiSeat, type MapAiTask, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Rider, Settler, Vehicle, VehicleDrive, vehicleCommander } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../../src/index.js';
import { hexDistance } from '../../../src/nav/halfcell.js';
import { AI_HANDLER_ROUND_TICKS } from '../../../src/systems/ai-shared/cadence.js';
import { vehicleAnchor } from '../../../src/systems/footprint/index.js';
import { CREW_REACH_POINTS, GUARD_SLACK_POINTS } from '../../../src/systems/map-ai/catapults.js';
import { CONDITION_ALWAYS } from '../../../src/systems/map-ai/index.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// The scripted handler's catapults: a man of the seat crews each one without a commander, and a crewed
// one guards its spot.

const VIKING = 1;
const SEAT = 2;
const SPEARMAN = 32;
const CATAPULT = 5;
const CATAPULT_JOB = 54;
const MAP = 128;
const CATAPULT_SPOT = { x: 40, y: 40 };
/** Two of the seat's turns: the attach on the first, the stance on it too. */
const TWO_TURNS = 2 * AI_HANDLER_ROUND_TICKS + 1;
/** Long enough for a drafted man to walk a few points and step aboard. */
const BOARD_TICKS = 300;
/** Long enough for a catapult to drive across the fixture map. */
const DRIVE_TICKS = 900;
/** How far a test drive takes the catapult off its spot: well past the slack. */
const DRIVEN_OFF_ROWS = 12;
/** A Defend post across the map from the catapult, which would claim every free man of the seat. */
const FAR_POST: MapAiTask = {
  kind: 'defend',
  priority: 10,
  condition: CONDITION_ALWAYS,
  x: 100,
  y: 100,
  range: 10,
  min: 0,
  max: 0,
};

/** {@link aiContent} with a catapult row: soldiers crew it. */
function catapultContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: CATAPULT_JOB, id: 'vehicle_catapult' }],
    vehicles: [
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: CATAPULT_JOB,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [SPEARMAN],
        commanderJob: SPEARMAN,
        hitpoints: 3000,
      },
    ],
  });
}

function seatRow(rows: Partial<MapAiSeat>): MapAiSeat {
  return {
    player: SEAT,
    allDisabled: false,
    computerDisabled: false,
    disabledComputerModules: [],
    conditions: [],
    tasks: [],
    ...rows,
  };
}

/** A seat left to its map program, or one whose computer player also runs its army (`military`). */
function simWith(military = false, tasks: MapAiTask[] = []): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: catapultContent(),
    map: grassNodeMap(MAP, MAP),
    mapAiScript: [seatRow(military ? { tasks } : { disabledComputerModules: ['military'], tasks })],
  });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military } });
  return sim;
}

function catapultAt(sim: Simulation, at: { x: number; y: number }): Entity {
  const e = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: CATAPULT,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: SEAT,
  });
  if (e === null) throw new Error('setup: the catapult is not in the content');
  return e;
}

function spearmanAt(sim: Simulation, at: { x: number; y: number }): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: SPEARMAN, x: at.x, y: at.y, tribe: VIKING, owner: SEAT });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: no settler spawned');
  return spawned;
}

function mapAiAttaches(sim: Simulation): number {
  return sim.commands.log.filter(
    (entry) =>
      entry.origin === 'ai' && entry.decisionSource === 'map-ai' && entry.command.kind === 'attachToVehicle',
  ).length;
}

describe('ai program catapults', () => {
  it('crews a commanderless catapult with the nearest man in reach and holds it on defence at its spot', () => {
    const sim = simWith();
    const catapult = catapultAt(sim, CATAPULT_SPOT);
    const near = spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + 4 });
    const farther = spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + 8 });
    sim.run(TWO_TURNS + BOARD_TICKS);
    const state = sim.world.get(catapult, Vehicle);
    expect(vehicleCommander(state)).toBe(near);
    expect(state.passengers.every((seat) => seat === null || seat.inside)).toBe(true);
    expect(sim.world.has(farther, Rider)).toBe(false);
    expect(state.stance).toBe('defence');
    expect(state.guard).toEqual(vehicleAnchor(sim.world, catapult));
  });

  it('takes the man it crews with off the Defend posts in the same turn', () => {
    const sim = simWith(false, [FAR_POST]);
    const catapult = catapultAt(sim, CATAPULT_SPOT);
    const driver = spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + 4 });
    sim.run(TWO_TURNS + BOARD_TICKS);
    // A move order applied after the attach would take him off the catapult again.
    const otherOrders = sim.commands.log.filter(
      (entry) =>
        entry.origin === 'ai' &&
        entry.decisionSource === 'map-ai' &&
        'entity' in entry.command &&
        entry.command.entity === driver &&
        entry.command.kind !== 'attachToVehicle',
    );
    expect(otherOrders).toEqual([]);
    const state = sim.world.get(catapult, Vehicle);
    expect(vehicleCommander(state)).toBe(driver);
    expect(state.passengers.every((seat) => seat === null || seat.inside)).toBe(true);
  });

  it('leaves a catapult uncrewed while no man stands within reach of it', () => {
    const sim = simWith();
    const catapult = catapultAt(sim, CATAPULT_SPOT);
    // Straight down the rows the map-point distance is the row count.
    const outside = spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + CREW_REACH_POINTS + 1 });
    sim.run(TWO_TURNS + BOARD_TICKS);
    expect(vehicleCommander(sim.world.get(catapult, Vehicle))).toBeNull();
    expect(sim.world.has(outside, Rider)).toBe(false);
    expect(mapAiAttaches(sim)).toBe(0);
  });

  it('leaves the catapults to the computer player while its military module runs', () => {
    const sim = simWith(true);
    catapultAt(sim, CATAPULT_SPOT);
    spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + 4 });
    sim.run(TWO_TURNS);
    expect(mapAiAttaches(sim)).toBe(0);
  });

  it('drives a catapult left idle off its guard spot back to it', () => {
    const sim = simWith();
    const catapult = catapultAt(sim, CATAPULT_SPOT);
    spearmanAt(sim, { x: CATAPULT_SPOT.x, y: CATAPULT_SPOT.y + 4 });
    sim.run(TWO_TURNS + BOARD_TICKS);
    const home = sim.world.get(catapult, Vehicle).guard;
    if (home === null) throw new Error('the catapult holds no guard spot');
    sim.enqueue(
      playerCommand(SEAT, {
        kind: 'moveVehicle',
        vehicle: catapult,
        x: home.hx,
        y: home.hy + DRIVEN_OFF_ROWS,
      }),
    );
    sim.run(DRIVE_TICKS);
    // A chase that lost its mark leaves the catapult off its spot and the guard spot behind
    // (`conflict/ranged/catapult.test.ts`); a goto moves the guard with it, so it is put back here.
    sim.world.mut(catapult, Vehicle).guard = { ...home };
    const away = vehicleAnchor(sim.world, catapult);
    if (away === null) throw new Error('the catapult stands nowhere');
    expect(hexDistance(away, home)).toBeGreaterThan(GUARD_SLACK_POINTS);
    sim.run(AI_HANDLER_ROUND_TICKS + DRIVE_TICKS);
    const back = vehicleAnchor(sim.world, catapult);
    if (back === null) throw new Error('the catapult stands nowhere');
    expect(sim.world.has(catapult, VehicleDrive)).toBe(false);
    expect(hexDistance(back, home)).toBeLessThanOrEqual(GUARD_SLACK_POINTS);
  });
});
