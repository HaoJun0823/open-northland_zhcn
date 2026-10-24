import { describe, expect, it } from 'vitest';
import { Vehicle } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { hexDistance } from '../../../src/nav/halfcell.js';
import { dockScriptedVehicles } from '../../../src/systems/missions/results/movement.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const SHIP = 3;
const ID = 7;
const POINT = { hx: 24, hy: 24 };

function dockWithOpening(distance: number) {
  const walk: { dx: number; dy: number }[] = [];
  // A synthetic obstruction with one opening on its east side; every other point through radius
  // ten is blocked, so only the snap boundary distinguishes the two cases.
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      if (dx === distance && dy === 0) continue;
      if (hexDistance(POINT, { hx: POINT.hx + dx, hy: POINT.hy + dy }) <= 10) walk.push({ dx, dy });
    }
  }
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(64, 64),
      landscapes: {
        types: [{ typeId: 900, walk, build: [], groups: [] }],
        placements: [{ id: 1, typeId: 900, ...POINT, level: 0 }],
      },
    },
  });
  const ctx = ctxOf(sim);
  const vehicle = createVehicle(sim.world, ctx, {
    vehicleType: SHIP,
    tribe: 0,
    owner: 0,
    x: 4,
    y: 4,
    missionId: ID,
  });
  if (vehicle === null) throw new Error('missing fixture ship');
  // Only the pending order is under test: the commander is still outside, before any sail starts.
  const commander = sim.world.create();
  const state = sim.world.mut(vehicle, Vehicle);
  state.passengers[state.passengers.length - 1] = { entity: commander, inside: false };
  dockScriptedVehicles(
    {
      world: sim.world,
      ctx,
      script: { missions: [] },
      records: [],
      clock: 0,
      report: () => {},
      reportFailed: () => {},
      checking: new Set(),
      halted: false,
    },
    ID,
    POINT,
  );
  return sim.world.get(vehicle, Vehicle).heldGoal;
}

describe('scripted docking snap', () => {
  it('accepts an open point on the ninth ring', () => {
    expect(dockWithOpening(9)).toEqual({ hx: POINT.hx + 9, hy: POINT.hy });
  });

  it('does not snap to an opening beyond the ninth ring', () => {
    expect(dockWithOpening(10)).toEqual(POINT);
  });
});
