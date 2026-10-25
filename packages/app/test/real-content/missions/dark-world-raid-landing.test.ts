import {
  components,
  type Entity,
  type MissionGoalOp,
  type MissionResultOp,
  type Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import { realMapWorld } from '../real-map-world.js';

const { MissionObjectId, Position, Rider } = components;

/**
 * The story map's first raid, run by its own script: the wave boards a ship, sails for the defended
 * coast, and a timed line orders the crew off near the ship's arrival. Whichever comes first, the crew
 * steps ashore once both the order and the mooring hold: a crew whose detach is refused at sea stays
 * aboard until the ship is sunk, so the raid never lands and the defence objective, which waits for
 * every raider's death, never completes. Holding an order taken at sea is covered by
 * `packages/sim/test/systems/missions/results/vehicles.test.ts`.
 */
const MAP_ID = 'mroczny_swiat';
/** The seat the map's story player holds. */
const STORY_PLAYER = 0;
/** Ticks from the trigger for the wave to spawn, board, sail and dock. */
const RAID_BUDGET_TICKS = 1500;
/** The tick after both the detach and the mooring, by which the crew has stepped ashore. */
const LANDING_TICKS = 1;

interface Wave {
  readonly mission: number;
  readonly crewId: number;
  /** The crew's tribe and job, ones the content holds: the trigger's human spawns with them. */
  readonly tribe: number;
  readonly job: number;
  readonly ship: number;
  readonly detachMission: number;
}

type Mission = NonNullable<Simulation['missions']>['missions'][number];

function missionsOf(sim: Simulation): readonly Mission[] {
  return sim.missions?.missions ?? [];
}

/** The script's first wave: the mission that spawns a crew, a ship, attaches and docks, with the mission
 *  that later orders the same crew off. */
function firstWave(sim: Simulation): Wave {
  for (const [mission, { results }] of missionsOf(sim).entries()) {
    const ship = results.find(
      (op): op is Extract<MissionResultOp, { opcode: 'SetVehicle' }> => op.opcode === 'SetVehicle',
    );
    const dock = results.find((op) => op.opcode === 'DockVehicle');
    const crew = results.find(
      (op): op is Extract<MissionResultOp, { opcode: 'SetHumanX' }> => op.opcode === 'SetHumanX',
    );
    if (ship === undefined || dock === undefined || crew === undefined) continue;
    const detachMission = missionsOf(sim).findIndex(({ results: later }) =>
      later.some((op) => op.opcode === 'DetachHumanFromVehicle' && op.humanId === crew.humanId),
    );
    if (detachMission < 0) continue;
    return {
      mission,
      crewId: crew.humanId,
      tribe: crew.tribe,
      job: crew.job,
      ship: ship.vehicleId,
      detachMission,
    };
  }
  throw new Error('the script has no scripted wave with a timed detach');
}

/** The proximity goal whose mission activates `wave`: a human with its id near its point starts the raid. */
function raidTrigger(sim: Simulation, wave: Wave): Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> {
  for (const { goals, results } of missionsOf(sim)) {
    if (!results.some((op) => op.opcode === 'ActivateMission' && op.missionIndex === wave.mission)) continue;
    const goal = goals.find(
      (op): op is Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> => op.opcode === 'FindPosByHumans',
    );
    if (goal !== undefined) return goal;
  }
  throw new Error('no proximity trigger activates the wave');
}

function crewOf(sim: Simulation, crewId: number): readonly Entity[] {
  return [...sim.world.query(MissionObjectId)].filter((e) => sim.world.get(e, MissionObjectId).id === crewId);
}

describe.runIf(hasRealIr())(`${MAP_ID}: the first scripted raid`, () => {
  it('lands its crew once the ship moors and the script has ordered them off', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, machineSeats: [] });
    const wave = firstWave(sim);
    const trigger = raidTrigger(sim, wave);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: wave.job,
      tribe: wave.tribe,
      x: trigger.point.hx,
      y: trigger.point.hy,
      owner: STORY_PLAYER,
      missionId: trigger.humanId,
    });
    let detached = false;
    let moored = false;
    const refused: string[] = [];
    let crew: readonly Entity[] = [];
    for (let tick = 0; tick < RAID_BUDGET_TICKS && !(detached && moored); tick++) {
      sim.step();
      for (const e of sim.events.current()) {
        if (e.kind === 'vehicleDocked' && e.player !== STORY_PLAYER) moored = true;
        if (e.kind === 'riderRefused') refused.push(JSON.stringify(e));
      }
      if (!detached && sim.missionStatus()[wave.detachMission]?.done === true) {
        detached = true;
        crew = crewOf(sim, wave.crewId);
      }
      // A moored ship keeps a scripted crew aboard until its line orders them off.
      if (moored && !detached) {
        for (const e of crewOf(sim, wave.crewId)) expect(sim.world.has(e, Position), 'aboard').toBe(false);
      }
    }
    expect(detached, 'the timed detach fires').toBe(true);
    expect(moored, 'the raiding ship docks').toBe(true);
    expect(refused).toEqual([]);
    expect(crew.length).toBeGreaterThan(0);
    sim.run(LANDING_TICKS);
    for (const e of crew) {
      expect(sim.world.has(e, Position), 'ashore').toBe(true);
      expect(sim.world.has(e, Rider), 'off the ship').toBe(false);
    }
  }, 300_000);
});
