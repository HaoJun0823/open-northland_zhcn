import { describe, expect, it } from 'vitest';
import {
  Building,
  Palisade,
  PalisadeBlocking,
  Position,
  VehicleDrive,
  VehicleRoute,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { adminCommand, nodeOfPosition, ONE, positionOfNode } from '../../src/index.js';
import {
  buildingDoorNodes,
  canPlaceBuilding,
  canPlaceWorkFlag,
  dynamicBlockOverlay,
  placementProbe,
  vehicleBlockedCells,
  vehicleFootprintNodes,
} from '../../src/systems/footprint/index.js';
import { placementBlockerGrid } from '../../src/systems/footprint/placement/blocker-grid.js';
import { canPlacePalisadeAnchor } from '../../src/systems/footprint/placement/building.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { ctxOf } from '../fixtures/context.js';
import { HUT, mappedSim, terrainOf, VIKING } from '../footprint/building-placement/support.js';

const OWNER = 0;
const HANDCART = 1;
const CATAPULT = 5;
const PLOT = { hx: 12, hy: 12 };

function cart(sim: ReturnType<typeof mappedSim>, type = HANDCART, hx = PLOT.hx, hy = PLOT.hy): Entity {
  const e = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: type,
    x: hx,
    y: hy,
    owner: OWNER,
    tribe: VIKING,
  });
  if (e === null) throw new Error('fixture vehicle missing');
  return e;
}

function place(sim: ReturnType<typeof mappedSim>): void {
  sim.enqueue(
    adminCommand({
      kind: 'placeBuilding',
      buildingType: HUT,
      ignoreTechnology: true,
      tribe: VIKING,
      owner: OWNER,
      x: PLOT.hx,
      y: PLOT.hy,
    }),
  );
  sim.step();
}

function anchor(sim: ReturnType<typeof mappedSim>, e: Entity) {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function expectClear(sim: ReturnType<typeof mappedSim>, vehicles: readonly Entity[]): void {
  const terrain = terrainOf(sim);
  const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
  const doors = buildingDoorNodes(sim.world, ctxOf(sim), terrain);
  const claimed = new Set<number>();
  for (const e of vehicles) {
    for (const node of vehicleFootprintNodes(sim.world, sim.content, terrain, e)) {
      expect(blocked.has(node)).toBe(false);
      expect(doors.has(node)).toBe(false);
      expect(claimed.has(node)).toBe(false);
      claimed.add(node);
    }
  }
  expect(sim.world.verifyCaches()).toEqual([]);
}

describe('buildings displace vehicles', () => {
  it('accepts a placement and its preview over a cart, but still blocks flags and walls', () => {
    const sim = mappedSim();
    const e = cart(sim);
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    expect(canPlaceBuilding(sim.world, ctx, terrain, HUT, VIKING, PLOT.hx, PLOT.hy)).toBe(true);
    expect(placementProbe(sim.world, sim.content, terrain, HUT, VIKING, []).canPlace(PLOT.hx, PLOT.hy)).toBe(
      true,
    );
    expect(canPlaceWorkFlag(sim.world, ctx, terrain, terrain.nodeAt(PLOT.hx, PLOT.hy))).toBe(false);
    expect(
      canPlacePalisadeAnchor(
        placementBlockerGrid(sim.world, sim.content, terrain),
        [{ dx: 0, dy: 0 }],
        PLOT.hx,
        PLOT.hy,
      ),
    ).toBe(false);
    vehicleBlockedCells(sim.world, ctx, terrain); // prime the old footprint
    place(sim);
    expect([...sim.world.query(Building)]).toHaveLength(1);
    expect(anchor(sim, e)).not.toEqual(PLOT);
    expect(vehicleBlockedCells(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(PLOT.hx, PLOT.hy))).toBe(
      false,
    );
    expectClear(sim, [e]);
  });

  it('moves an overlapping catapult even when its anchor is outside, and separates several vehicles', () => {
    const sim = mappedSim();
    const vehicles = [cart(sim), cart(sim, HANDCART, PLOT.hx + 1), cart(sim, CATAPULT, PLOT.hx + 2)];
    const old = vehicles.map((e) => anchor(sim, e));
    place(sim);
    for (const [i, e] of vehicles.entries()) expect(anchor(sim, e)).not.toEqual(old[i]);
    expectClear(sim, vehicles);
  });

  it('waives only vehicles: a house on the same cells still refuses another house', () => {
    const sim = mappedSim();
    place(sim);
    cart(sim);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, VIKING, PLOT.hx, PLOT.hy)).toBe(
      false,
    );
    place(sim);
    expect([...sim.world.query(Building)]).toHaveLength(1);
  });

  it('keeps a cart standing in the reserved margin, outside the body', () => {
    const sim = mappedSim();
    const e = cart(sim, HANDCART, PLOT.hx, PLOT.hy + 2);
    const before = anchor(sim, e);
    place(sim);
    expect([...sim.world.query(Building)]).toHaveLength(1);
    expect(anchor(sim, e)).toEqual(before);
  });

  it('starts a moving cart route again from its landing instead of interpolating through the house', () => {
    const sim = mappedSim();
    const e = cart(sim);
    sim.world.add(e, VehicleDrive, {
      goal: { hx: 24, hy: 12 },
      step: 1,
      from: { hx: 11, hy: 12 },
      progress: 3,
      increment: 10,
      helm: null,
    });
    sim.world.add(e, VehicleRoute, {
      nodes: [
        { hx: 12, hy: 12 },
        { hx: 13, hy: 12 },
        { hx: 14, hy: 12 },
      ],
    });

    place(sim);
    expect(anchor(sim, e)).not.toEqual(PLOT);
    expect(sim.world.get(e, VehicleDrive).goal).toEqual({ hx: 24, hy: 12 });
    expect(sim.world.get(e, VehicleDrive).from).not.toEqual({ hx: 11, hy: 12 });
    expectClear(sim, [e]);
  });

  it('displaces a cart beside the body when the new house closes its last exit', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const e = cart(sim, HANDCART, PLOT.hx, PLOT.hy - 1);
    const before = anchor(sim, e);
    for (const n of terrain.neighbours(terrain.nodeAt(before.hx, before.hy))) {
      if (terrain.yOf(n) === PLOT.hy && [PLOT.hx, PLOT.hx + 1].includes(terrain.xOf(n))) continue;
      const wall = sim.world.create();
      sim.world.add(wall, Position, positionOfNode(terrain.xOf(n), terrain.yOf(n)));
      sim.world.add(wall, Palisade, {
        gfxIndex: 1,
        tribe: VIKING,
        built: ONE,
        walk: [{ dx: 0, dy: 0 }],
        placementWalk: [{ dx: 0, dy: 0 }],
        construction: [],
        repairPerStrike: 1,
        reservation: null,
        gate: null,
      });
      sim.world.add(wall, PalisadeBlocking, {});
    }
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, VIKING, PLOT.hx, PLOT.hy)).toBe(true);
    place(sim);
    expect([...sim.world.query(Building)]).toHaveLength(1);
    expect(anchor(sim, e)).not.toEqual(before);
    expectClear(sim, [e]);
  });
});
