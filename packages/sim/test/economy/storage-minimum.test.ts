import { describe, expect, it } from 'vitest';
import {
  Carrying,
  Owner,
  STORAGE_MINIMUM_MAX,
  Stockpile,
  StorageMinimums,
  storageMinimumOf,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { consumeFood } from '../../src/systems/settlers/atomics/effects/goods/consume.js';
import { pickupFromStore } from '../../src/systems/settlers/atomics/effects/goods/transfer.js';
import { buildingAt, ctxOf, FARM, grassMap, settlerAt, WHEAT } from './producer-supply/support.js';
import { BAKERY, CARRIER, OPERATOR, utilityContent, WAREHOUSE, WATER, WELL } from './utility-content.js';

// A player's storage minimum: its storehouses keep that many units of a good between them, nobody takes
// the good out below it, and a self-filling house's carrier brings its good to storage first while they
// hold less.

const PLAYER = 0;
const MAP_WIDTH = 16;
/** Ticks enough for a baker to fetch from the warehouse and come back a few times. */
const FETCH_TICKS = 1200;
/** An upper bound on the ticks a well carrier needs to deliver a few units along the strip. */
const DELIVERY_TICKS = 4000;
const CARRY_LOAD = 5;

function world(): Simulation {
  return new Simulation({ seed: 1, content: utilityContent(), map: grassMap(MAP_WIDTH, 1) });
}

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function setMinimum(sim: Simulation, goodType: number, amount: number): void {
  sim.enqueueSetup({ kind: 'setStorageMinimum', player: PLAYER, goodType, amount });
  sim.step();
}

const waterIn = (sim: Simulation, store: Entity): number =>
  sim.world.get(store, Stockpile).amounts.get(WATER) ?? 0;

describe('the setStorageMinimum command', () => {
  it('sets, clamps and lifts one good’s minimum, keeping no carrier at zero', () => {
    const sim = world();
    setMinimum(sim, WATER, 30);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(30);

    setMinimum(sim, WATER, STORAGE_MINIMUM_MAX + 1);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(STORAGE_MINIMUM_MAX);

    setMinimum(sim, WATER, 0);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(0);
    expect([...sim.world.query(StorageMinimums)]).toHaveLength(0);
  });

  it('ignores a good the content does not know', () => {
    const sim = world();
    setMinimum(sim, 9999, 5);
    expect([...sim.world.query(StorageMinimums)]).toHaveLength(0);
  });

  it('survives a save and restore', () => {
    const sim = world();
    setMinimum(sim, WATER, 12);
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim, { mapId: 'strip' }))));
    const restored = restoreSimulation(save, { content: utilityContent(), map: grassMap(MAP_WIDTH, 1) });
    expect(storageMinimumOf(restored.world, PLAYER, WATER)).toBe(12);
  });
});

describe('a storage minimum holds stock back', () => {
  /** A baker beside an empty bakery and a warehouse of 5 water, after `minimum` was set and a long run. */
  function warehouseAfterBaking(minimum: number): number {
    const sim = world();
    const bakery = owned(sim, buildingAt(sim, BAKERY, 0, 0));
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 8, 0, [[WATER, 5]]));
    owned(sim, settlerAt(sim, 0, 0, OPERATOR, bakery));
    if (minimum > 0) setMinimum(sim, WATER, minimum);
    sim.run(FETCH_TICKS);
    return waterIn(sim, warehouse);
  }

  it('lets a workshop take only the units above it', () => {
    expect(warehouseAfterBaking(0)).toBeLessThan(3);
    expect(warehouseAfterBaking(3)).toBe(3);
    expect(warehouseAfterBaking(5)).toBe(5);
  });

  it('counts the minimum over every storehouse of the player', () => {
    const sim = world();
    const bakery = owned(sim, buildingAt(sim, BAKERY, 0, 0));
    const near = owned(sim, buildingAt(sim, WAREHOUSE, 4, 0, [[WATER, 2]]));
    const far = owned(sim, buildingAt(sim, WAREHOUSE, 12, 0, [[WATER, 2]]));
    owned(sim, settlerAt(sim, 0, 0, OPERATOR, bakery));
    setMinimum(sim, WATER, 3);
    sim.run(FETCH_TICKS);
    expect(waterIn(sim, near) + waterIn(sim, far)).toBe(3);
  });

  it('caps a pickup that reaches a store at its minimum', () => {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 5]]));
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 3);

    pickupFromStore(sim.world, ctxOf(sim), carrier, warehouse, WATER, CARRY_LOAD);

    expect(waterIn(sim, warehouse)).toBe(3);
    expect(sim.world.get(carrier, Carrying).amount).toBe(2);
  });

  it('leaves the unit on the shelf for a meal at the minimum', () => {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 3]]));
    const eater = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 3);

    consumeFood(sim.world, ctxOf(sim), eater, warehouse, WATER);

    expect(waterIn(sim, warehouse)).toBe(3);
  });

  it('leaves a house that is no storehouse alone, a farm’s crop included', () => {
    const sim = world();
    const farm = owned(sim, buildingAt(sim, FARM, 2, 0, [[WHEAT, 4]]));
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WHEAT, 10);

    pickupFromStore(sim.world, ctxOf(sim), carrier, farm, WHEAT, CARRY_LOAD);

    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT)).toBe(0);
    expect(sim.world.get(carrier, Carrying).amount).toBe(4);
  });

  it('binds only its own player’s storehouses', () => {
    const sim = world();
    const warehouse = buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 5]]);
    sim.world.add(warehouse, Owner, { player: PLAYER + 1 });
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 5);

    pickupFromStore(sim.world, ctxOf(sim), carrier, warehouse, WATER, CARRY_LOAD);

    expect(waterIn(sim, warehouse)).toBe(0);
  });
});

describe('a well carrier under a storage minimum', () => {
  /** Where the well carrier's first deliveries landed: run until `units` arrived anywhere. */
  function firstDeliveries(minimum: number, units: number): { warehouse: number; bakery: number } {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
    const well = owned(sim, buildingAt(sim, WELL, 6, 0));
    const bakery = owned(sim, buildingAt(sim, BAKERY, 9, 0)); // nearer the well than the warehouse
    owned(sim, settlerAt(sim, 6, 0, CARRIER, well));
    if (minimum > 0) setMinimum(sim, WATER, minimum);
    for (let t = 0; t < DELIVERY_TICKS && waterIn(sim, warehouse) + waterIn(sim, bakery) < units; t++) {
      sim.step();
    }
    return { warehouse: waterIn(sim, warehouse), bakery: waterIn(sim, bakery) };
  }

  it('feeds the consumer first without one', () => {
    expect(firstDeliveries(0, 3)).toEqual({ warehouse: 0, bakery: 3 });
  });

  it('fills storage up to the minimum first, then the consumer again', () => {
    expect(firstDeliveries(2, 2)).toEqual({ warehouse: 2, bakery: 0 });
    expect(firstDeliveries(2, 4)).toEqual({ warehouse: 2, bakery: 2 });
  });
});

describe('storage minimum determinism', () => {
  it('drives the well, warehouse and baker to a byte-identical state from the same seed', () => {
    const run = (): string => {
      const sim = world();
      owned(sim, buildingAt(sim, WAREHOUSE, 0, 0, [[WATER, 2]]));
      const well = owned(sim, buildingAt(sim, WELL, 6, 0));
      const bakery = owned(sim, buildingAt(sim, BAKERY, 9, 0));
      owned(sim, settlerAt(sim, 6, 0, CARRIER, well));
      owned(sim, settlerAt(sim, 9, 0, OPERATOR, bakery));
      setMinimum(sim, WATER, 4);
      sim.run(FETCH_TICKS);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
