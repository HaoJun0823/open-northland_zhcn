import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  Building,
  Carrying,
  CurrentAtomic,
  GroundDrop,
  Owner,
  Position,
  Residence,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type NodeId, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { atomicSystem, plannerSystem } from '../../src/systems/index.js';
import { collectTargets, nearestFood } from '../../src/systems/settlers/targets/index.js';
import { collectSupplyTally } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, nextTickCtxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { needsSettlerAt } from './needs/support.js';

const FOOD = 3;
const BREAD = 7;
const FISH = 101;
const HOME = 90;
const FOOD_PROCESSOR = 91;
const SOURCES = ['store', 'ground', 'producer', 'bush', 'home'] as const;
type Source = (typeof SOURCES)[number];

function fixture() {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: FISH, id: 'fish', weight: 1 }],
    buildings: [
      ...base.buildings,
      {
        typeId: FOOD_PROCESSOR,
        id: 'food_processor',
        kind: 'workplace',
        stock: [
          { goodType: FOOD, capacity: 5 },
          { goodType: BREAD, capacity: 5 },
        ],
        recipes: [
          { inputs: [{ goodType: FOOD, amount: 1 }], outputs: [{ goodType: BREAD, amount: 1 }], ticks: 20 },
        ],
        produces: [BREAD],
      },
      {
        typeId: HOME,
        id: 'home_small',
        kind: 'home',
        homeSize: 2,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
    ],
  });
  const sim = new Simulation({ seed: 7, content, map: grassNodeMap(160, 20) });
  const eater = needsSettlerAt(sim, 1, 3, { hunger: ONE });
  sim.world.add(eater, Owner, { player: 0 });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture terrain missing');
  const add = (kind: Source, x: number): Entity => {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(x, 6));
    if (kind === 'bush') {
      sim.world.add(e, BerryBush, { stage: 'ripe', nextStageAtTick: 0 });
    } else {
      sim.world.add(e, Owner, { player: 0 });
      const goodType = kind === 'producer' ? BREAD : kind === 'ground' ? FISH : FOOD;
      sim.world.add(e, Stockpile, { amounts: new Map([[goodType, 2]]) });
      if (kind === 'ground') {
        sim.world.add(e, GroundDrop, { goodType });
      } else {
        sim.world.add(e, Building, {
          buildingType: kind === 'home' ? HOME : kind === 'producer' ? 21 : 1,
          tribe: 1,
          built: ONE,
          level: 0,
        });
      }
      if (kind === 'home') sim.world.add(eater, Residence, { home: e });
    }
    return e;
  };
  const supply = collectSupplyTally(sim.world);
  const pick = (gate?: Parameters<typeof nearestFood>[7]) =>
    nearestFood(
      collectTargets(sim.world, ctxOf(sim), terrain),
      sim.world,
      ctxOf(sim),
      supply,
      terrain,
      terrain.nodeAt(2, 6),
      eater,
      gate,
    );
  return { sim, eater, terrain, add, pick, supply };
}

function sourceOf(food: ReturnType<typeof nearestFood>): Entity | undefined {
  return food?.kind === 'bush' ? food.bush : food?.store;
}

describe('one nearest-meal search', () => {
  it.each(SOURCES.flatMap((near) => SOURCES.filter((far) => far !== near).map((far) => ({ near, far }))))(
    'chooses nearer $near over farther $far, including beyond the former bush cap',
    ({ near, far }) => {
      const { add, pick, sim } = fixture();
      add(far, 76); // Create the farther source first: insertion order must not win.
      const closer = add(near, 70);
      expect(sourceOf(pick())).toBe(closer);
      expect(sim.world.verifyCaches()).toEqual([]);
    },
  );

  it.each(SOURCES)('applies the same walking boundary to %s', (kind) => {
    const { add, pick, terrain } = fixture();
    const source = add(kind, 22);
    const gate = (maxX: number) => ({
      bounds: { minX: 0, maxX, minY: 0, maxY: 19 },
      allowsNode: (cell: NodeId) => terrain.xOf(cell) <= maxX,
    });
    expect(sourceOf(pick(gate(22)))).toBe(source);
    expect(pick(gate(21))).toBeNull();
  });

  it.each(['store', 'ground', 'producer', 'home'] as const)(
    'skips exhausted or fully claimed %s but admits a remaining portion',
    (kind) => {
      const { sim, add, pick, supply } = fixture();
      const source = add(kind, 6);
      const bush = add('bush', 12);
      const goodType = kind === 'ground' ? FISH : kind === 'producer' ? BREAD : FOOD;
      const other = needsSettlerAt(sim, 2, 3, { hunger: ONE });
      supply.stampPickupClaim(other, { source, goodType, amount: 1 });
      expect(sourceOf(pick())).toBe(source);
      supply.stampPickupClaim(other, { source, goodType, amount: 2 });
      expect(sourceOf(pick())).toBe(bush);
      sim.world.mut(source, Stockpile).amounts.set(goodType, 0);
      supply.releasePickupClaim(other);
      expect(sourceOf(pick())).toBe(bush);
    },
  );

  it('reads ownership, fruit ripeness and restocking live after the index was built', () => {
    const { sim, add, pick } = fixture();
    const store = add('store', 6);
    const bush = add('bush', 12);
    expect(sourceOf(pick())).toBe(store);
    sim.world.mut(store, Owner).player = 1;
    expect(sourceOf(pick())).toBe(bush);
    sim.world.mut(bush, BerryBush).stage = 'bare';
    expect(pick()).toBeNull();
    sim.world.mut(bush, BerryBush).stage = 'ripe';
    expect(sourceOf(pick())).toBe(bush);
    sim.world.mut(store, Owner).player = 0;
    sim.world.mut(store, Stockpile).amounts.set(FOOD, 0);
    expect(sourceOf(pick())).toBe(bush);
    sim.world.mut(store, Stockpile).amounts.set(FOOD, 1);
    expect(sourceOf(pick())).toBe(store);
  });

  it('keeps the meal index current after moving, replacing and destroying sources', () => {
    const { sim, add, pick } = fixture();
    const store = add('store', 6);
    const bush = add('bush', 12);
    expect(sourceOf(pick())).toBe(store);
    sim.world.add(store, Position, positionOfNode(20, 6));
    expect(sourceOf(pick())).toBe(bush);
    sim.world.remove(bush, BerryBush);
    sim.world.add(bush, Stockpile, { amounts: new Map([[FOOD, 1]]) });
    expect(pick()).toMatchObject({ kind: 'store', store: bush });
    sim.world.destroy(bush);
    expect(sourceOf(pick())).toBe(store);
    const fresh = add('ground', 8);
    expect(sourceOf(pick())).toBe(fresh);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it.each(['store', 'bush', 'home'] as const)(
    'breaks equal-distance ties by cell, even against %s',
    (kind) => {
      const { sim, eater, add, terrain, supply } = fixture();
      const right = add(kind, 26);
      const left = add(kind === 'bush' ? 'store' : 'bush', 14);
      const pick = nearestFood(
        collectTargets(sim.world, ctxOf(sim), terrain),
        sim.world,
        ctxOf(sim),
        supply,
        terrain,
        terrain.nodeAt(20, 6),
        eater,
      );
      expect(sourceOf(pick)).toBe(left);
      expect(sourceOf(pick)).not.toBe(right);
    },
  );

  it.each(['store', 'bush'] as const)(
    'breaks a shared-cell tie by entity id when %s was created first',
    (kind) => {
      const { add, pick } = fixture();
      const first = add(kind, 8);
      add(kind === 'bush' ? 'store' : 'bush', 8);
      expect(sourceOf(pick())).toBe(first);
    },
  );

  it('keeps the nearest meal when a large mixed index switches to its spatial search', () => {
    const { sim, add, pick } = fixture();
    const nearest = add('bush', 70);
    add('store', 76);
    expect(sourceOf(pick())).toBe(nearest);
    for (let i = 0; i < 80; i++) {
      add('bush', 80 + i);
    }
    expect(sourceOf(pick())).toBe(nearest);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it.each([FOOD, BREAD, FISH])('eats its own carried good %i without walking to other food', (goodType) => {
    const { sim, eater, add } = fixture();
    sim.world.add(eater, Carrying, { goodType, amount: 2 });
    const bush = add('bush', 6);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(eater, CurrentAtomic).effect).toEqual({ kind: 'eat', from: null, goodType });
    sim.run(5);
    expect(sim.world.get(eater, Carrying).amount).toBe(1);
    expect(sim.world.get(bush, BerryBush).stage).toBe('ripe');
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('leaves production ingredients untouched and eats only the finished food at a workshop', () => {
    const { sim, eater, add, pick } = fixture();
    const workshop = add('producer', 3); // The eater's half-cell on this odd visual row.
    sim.world.mut(workshop, Building).buildingType = FOOD_PROCESSOR;
    sim.world.mut(workshop, Stockpile).amounts.set(FOOD, 3);
    const bush = add('bush', 8);

    expect(pick()).toMatchObject({ kind: 'store', store: workshop, goodType: BREAD });
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(eater, CurrentAtomic).effect).toEqual({
      kind: 'eat',
      from: workshop,
      goodType: BREAD,
    });
    // Run the meal alone: production is allowed to consume its own ingredient independently.
    for (let tick = 0; tick < 5; tick++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(bush, BerryBush).stage).toBe('ripe');
    expect(sim.world.get(workshop, Stockpile).amounts.get(BREAD)).toBe(1);
    expect(sim.world.get(workshop, Stockpile).amounts.get(FOOD)).toBe(3);
    sim.world.mut(workshop, Stockpile).amounts.set(BREAD, 0);
    expect(sourceOf(pick())).toBe(bush);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('does not treat food carried by another settler as a public meal', () => {
    const { sim, add, pick } = fixture();
    const carrier = needsSettlerAt(sim, 2, 3, { hunger: ONE });
    sim.world.add(carrier, Carrying, { goodType: FISH, amount: 2 });
    const bush = add('bush', 12);
    expect(sourceOf(pick())).toBe(bush);
  });
});
