import { describe, expect, it } from 'vitest';
import {
  MissionBehaviour,
  MissionObjectId,
  Position,
  Settler,
  seatPassenger,
  Vehicle,
} from '../../src/components/index.js';
import { cellAnchorNode, Simulation } from '../../src/index.js';
import { missionObjectIds, missionObjects } from '../../src/systems/missions/index.js';
import { entityPoint } from '../../src/systems/missions/targets.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The mission object ids placements carry into the world, and the lookup the goals address them
 * through. An id names a group, so several placements share one and every lookup answers a list.
 */

const VIKING = 1;
const BEAR = 10;
const WOODCUTTER = 1;
const HEADQUARTERS = 1;
const HANDCART = 1;
const SHIP_SMALL = 3;
const CATAPULT = 5;
const SQUAD_ID = 200;
const CAMP_ID = 1000;

function placed(): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 20) });
  const at = (x: number, y: number): { x: number; y: number } => {
    const n = cellAnchorNode(x, y);
    return { x: n.hx, y: n.hy };
  };
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    force: true,
    missionId: CAMP_ID,
    ...at(2, 2),
  });
  for (const x of [6, 8]) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      tribe: VIKING,
      missionId: SQUAD_ID,
      behaviourFlags: 16937,
      ...at(x, 6),
    });
  }
  // An unaddressed settler beside them: no id column, so no component and no group.
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, tribe: VIKING, ...at(10, 6) });
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: BEAR, count: 1, missionId: SQUAD_ID, ...at(12, 6) });
  sim.step();
  return sim;
}

describe('mission object ids on placed entities', () => {
  it('stamps the authored id and behaviour mask, and nothing on a placement without one', () => {
    const sim = placed();
    const stamped = [...sim.world.query(MissionObjectId)];
    expect(stamped).toHaveLength(4); // one house, two settlers, one animal
    expect([...sim.world.query(MissionBehaviour)].map((e) => sim.world.get(e, MissionBehaviour))).toEqual([
      { flags: 16937 },
      { flags: 16937 },
    ]);
    expect(missionObjectIds(sim.world)).toEqual([SQUAD_ID, CAMP_ID]);
  });

  it('groups every carrier of one id, ascending, across humans, houses and animals', () => {
    const sim = placed();
    const squad = missionObjects(sim.world, SQUAD_ID);
    expect(squad).toHaveLength(3);
    expect([...squad]).toEqual([...squad].sort((a, b) => a - b));
    expect(missionObjects(sim.world, CAMP_ID)).toHaveLength(1);
    expect(missionObjects(sim.world, 4242)).toEqual([]);
  });

  it('answers the lowest-id human of a group for a briefing picture, never a house or an animal', () => {
    const sim = placed();
    const humans = missionObjects(sim.world, SQUAD_ID).filter((e) => sim.world.has(e, Settler));
    expect(sim.missionHuman(SQUAD_ID)).toBe(Math.min(...humans));
    expect(sim.missionHuman(CAMP_ID)).toBeNull(); // only the house carries it
    expect(sim.missionHuman(4242)).toBeNull();
  });

  it('centres a group on the mean point of its humans or houses alone, rounded toward zero', () => {
    const sim = placed();
    const points = missionObjects(sim.world, SQUAD_ID)
      .filter((e) => sim.world.has(e, Settler))
      .map((e) => entityPoint(sim.world, e));
    const [a, b] = points;
    if (a === undefined || b === undefined) throw new Error('the placed squad has no two humans on the map');
    expect(sim.missionCentre('human', SQUAD_ID)).toEqual({
      hx: Math.trunc((a.hx + b.hx) / 2),
      hy: Math.trunc((a.hy + b.hy) / 2),
    });
    const [camp] = missionObjects(sim.world, CAMP_ID);
    if (camp === undefined) throw new Error('the placed camp carries no entity');
    expect(sim.missionCentre('house', CAMP_ID)).toEqual(entityPoint(sim.world, camp));
    expect(sim.missionCentre('house', SQUAD_ID)).toBeNull(); // the bear is no house
    expect(sim.missionCentre('vehicle', SQUAD_ID)).toBeNull();
    expect(sim.missionCentre('human', 4242)).toBeNull();
  });

  it('centres a vehicle group on the mean point of its vehicles', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 20) });
    for (const [x, y] of [
      [4, 4],
      [9, 7],
    ] as const) {
      const n = cellAnchorNode(x, y);
      sim.enqueueSetup({
        kind: 'createVehicle',
        vehicleType: HANDCART,
        tribe: VIKING,
        missionId: SQUAD_ID,
        x: n.hx,
        y: n.hy,
      });
    }
    sim.step();
    const [a, b] = missionObjects(sim.world, SQUAD_ID).map((e) => entityPoint(sim.world, e));
    if (a === undefined || b === undefined) throw new Error('the two carts stand nowhere');
    expect(sim.missionCentre('vehicle', SQUAD_ID)).toEqual({
      hx: Math.trunc((a.hx + b.hx) / 2),
      hy: Math.trunc((a.hy + b.hy) / 2),
    });
    expect(sim.missionCentre('human', SQUAD_ID)).toBeNull();
  });

  it('counts a rider aboard where its vehicle stands, and a vehicle inside a ship where the ship does', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 20) });
    const catapultAt = cellAnchorNode(6, 6);
    const shipAt = cellAnchorNode(12, 10);
    const catapult = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: CATAPULT,
      tribe: VIKING,
      x: catapultAt.hx,
      y: catapultAt.hy,
    });
    const ship = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: SHIP_SMALL,
      tribe: VIKING,
      x: shipAt.hx,
      y: shipAt.hy,
    });
    if (catapult === null || ship === null) throw new Error('the fixture lacks the catapult or the ship');
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      tribe: VIKING,
      missionId: SQUAD_ID,
      x: catapultAt.hx,
      y: catapultAt.hy,
    });
    sim.step();
    const [rider] = missionObjects(sim.world, SQUAD_ID);
    if (rider === undefined || !seatPassenger(sim.world, catapult, rider))
      throw new Error('no seat for the rider');
    boardRider(sim.world, rider, catapult);
    expect(entityPoint(sim.world, rider)).toBeUndefined(); // still off the map for everything else
    expect(sim.missionCentre('human', SQUAD_ID)).toEqual(catapultAt);

    sim.world.mut(catapult, Vehicle).carrier = ship;
    sim.world.remove(catapult, Position); // as a vehicle that drove into the ship
    expect(sim.missionCentre('human', SQUAD_ID)).toEqual(shipAt);

    const shore = cellAnchorNode(12, 12);
    const moored = sim.world.mut(ship, Vehicle);
    moored.moored = true; // as a ship lying at a shore
    moored.mooring = shore;
    expect(sim.missionCentre('human', SQUAD_ID)).toEqual(shore);
  });

  it('drops a removed entity from its group on the next lookup', () => {
    const sim = placed();
    const first = missionObjects(sim.world, SQUAD_ID)[0];
    if (first === undefined) throw new Error('the placed squad carries no entity to remove');
    sim.world.destroy(first);
    expect(missionObjects(sim.world, SQUAD_ID)).toHaveLength(2);
    expect(missionObjects(sim.world, SQUAD_ID)).not.toContain(first);
  });
});
