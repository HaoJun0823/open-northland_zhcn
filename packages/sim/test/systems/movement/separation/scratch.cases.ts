import { ANIMAL_WATER_TRIBES } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Owner,
  PathFollow,
  Person,
  setSettlerJob,
  setSettlerTribe,
} from '../../../../src/components/index.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import {
  colliderKinds,
  FIRM_COLLIDER,
  NOT_A_COLLIDER,
  SOFT_COLLIDER,
} from '../../../../src/systems/movement/collision/collider-kinds.js';
import { collectColliders } from '../../../../src/systems/movement/collision/separation/colliders.js';
import { separationScratch } from '../../../../src/systems/movement/collision/separation/scratch.js';
import { SlotGrid } from '../../../../src/systems/movement/collision/separation/slot-grid.js';
import { P0, SOLDIER, settlerAt, sim, WOODCUTTER, walkStraightTo } from './support.js';

const OFF_LATTICE = -1;
/** Bits per occupancy word of the slot grid. */
const WORD_BITS = 32;
/** A wildlife tribe that swims, so a member without a Person is no land collider. */
const WATER_TRIBE = [...ANIMAL_WATER_TRIBES][0] ?? 0;

function collected(grid: SlotGrid, x: number, y: number): number[] {
  const out: number[] = [];
  out.length = grid.collect(x, y, out, 0);
  return out;
}

describe('unit body collision - scratch lifetime', () => {
  it('lists a node ascending and forgets what the previous fill held', () => {
    const terrain = sim().terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const grid = new SlotGrid();

    grid.fill(terrain, 3, [2, 2, 3], [1, 1, 1]);
    expect(collected(grid, 2, 1)).toEqual([0, 1]);
    expect(collected(grid, 3, 1)).toEqual([2]);

    grid.fill(terrain, 1, [3], [1]);
    expect(collected(grid, 2, 1)).toEqual([]);
    expect(collected(grid, 3, 1)).toEqual([0]);
  });

  it('keeps an off-lattice slot findable at its own node', () => {
    const terrain = sim().terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const grid = new SlotGrid();

    grid.fill(terrain, 3, [OFF_LATTICE, 0, OFF_LATTICE], [0, 0, 0]);

    expect(collected(grid, OFF_LATTICE, 0)).toEqual([0, 2]);
    expect(collected(grid, 0, 0)).toEqual([1]);
  });

  it('collects the node block around a slot in node order without the slot, inside and on the lattice edge', () => {
    const terrain = sim().terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const grid = new SlotGrid();
    const around = (slot: number): number[] => {
      const out: number[] = [];
      out.length = grid.collectAround(slot, out);
      return out;
    };
    // The node after the first occupancy word's last bit, one row down, so the block above (x, 2) spans
    // two words.
    expect(terrain.width).toBeLessThan(WORD_BITS);
    const wordEdge = WORD_BITS - terrain.width;
    const hx = [3, 2, 4, 3, 5, 0, 8, 8, 10, wordEdge, wordEdge - 1];
    const hy = [2, 3, 1, 2, 2, 0, 4, 4, 2, 1, 2];

    grid.fill(terrain, hx.length, hx, hy);
    expect(around(0)).toEqual([1, 3, 2]);
    expect(around(3)).toEqual([1, 0, 2]);
    expect(around(2)).toEqual([0, 3, 4]);
    expect(around(5)).toEqual([]);
    expect(around(6)).toEqual([7]);
    expect(around(7)).toEqual([6]);
    expect(around(8)).toEqual([]);
    expect(around(10)).toEqual([9]);

    grid.fill(terrain, 1, [3], [2]);
    expect(around(0)).toEqual([]);
  });

  it('re-kinds a collider whose trade or owner changes and one created after the first read', () => {
    const s = sim();
    const worker = settlerAt(s, 2, 2, WOODCUTTER, P0);
    const kindOf = (e: number): number => colliderKinds(s.world, s.content)[e] ?? NOT_A_COLLIDER;
    expect(kindOf(worker)).toBe(SOFT_COLLIDER);

    setSettlerJob(s.world, worker, SOLDIER);
    expect(kindOf(worker)).toBe(FIRM_COLLIDER);
    s.world.remove(worker, Owner);
    expect(kindOf(worker)).toBe(NOT_A_COLLIDER);
    const late = settlerAt(s, 4, 2, SOLDIER, P0);
    expect(kindOf(late)).toBe(FIRM_COLLIDER);
    s.world.destroy(late);
    expect(kindOf(late)).toBe(NOT_A_COLLIDER);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('re-kinds a water-tribe settler as it gains and loses its Person', () => {
    const s = sim();
    const swimmer = settlerAt(s, 2, 2, WOODCUTTER, P0);
    const kindOf = (e: number): number => colliderKinds(s.world, s.content)[e] ?? NOT_A_COLLIDER;
    setSettlerTribe(s.world, swimmer, WATER_TRIBE);
    expect(kindOf(swimmer)).toBe(SOFT_COLLIDER); // a Person walks on land whatever its tribe

    s.world.remove(swimmer, Person);
    expect(kindOf(swimmer)).toBe(NOT_A_COLLIDER);
    expect(s.world.verifyCaches()).toEqual([]);
    s.world.add(swimmer, Person, { person: true });
    expect(kindOf(swimmer)).toBe(SOFT_COLLIDER);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('refills the mover columns in ascending id and drops a mover that stopped', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const walker = settlerAt(s, 2, 2, WOODCUTTER, P0);
    const other = settlerAt(s, 6, 2, WOODCUTTER, P0);
    walkStraightTo(s, other, 8, 2);
    walkStraightTo(s, walker, 4, 2);
    const ctx: SystemContext = {
      content: s.content,
      rng: s.rng,
      names: s.names,
      tick: 0,
      events: s.events,
      commands: s.commands,
    };
    const scratch = separationScratch(s.world);

    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(true);
    expect(scratch.movers.entity.slice(0, scratch.movers.count)).toEqual([walker, other]);

    s.world.remove(walker, PathFollow);
    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(true);
    expect(scratch.movers.entity.slice(0, scratch.movers.count)).toEqual([other]);

    s.world.remove(other, PathFollow);
    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(false);
  });
});
