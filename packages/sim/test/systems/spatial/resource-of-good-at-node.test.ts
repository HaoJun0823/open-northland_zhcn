import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../../src/systems/index.js';
import { resourceOfGoodAtNode } from '../../../src/systems/spatial/resources.js';
import { testContent } from '../../fixtures/content.js';

/**
 * The "standing resource of this good on this node" join behind the ground-drop → deposit work-cell match.
 * Pinned here: the pick is the LOWEST id on the node, an incremental removal surfaces the runner-up, and a
 * value-overwriting re-`add` re-keys the good.
 */

const { Position, Resource } = components;
const WOOD = 1;
const STONE = 2;
const ATOMIC = 24;

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent() });
}

function resourceAt(sim: Simulation, hx: number, hy: number, good: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: good, remaining: 3, harvestAtomic: ATOMIC });
  stampResourceFootprintData(sim.world, e, anchorOnlyFootprint());
  return e;
}

describe('resourceOfGoodAtNode (the ground-drop deposit join index)', () => {
  it('picks the lowest id per (node, good) and misses cleanly elsewhere', () => {
    const sim = newSim();
    const wood = resourceAt(sim, 5, 5, WOOD);
    const laterWood = resourceAt(sim, 5, 5, WOOD);
    const stone = resourceAt(sim, 5, 5, STONE);
    expect(resourceOfGoodAtNode(sim.world, 5, 5, WOOD)).toBe(wood);
    expect(laterWood).toBeGreaterThan(wood);
    expect(resourceOfGoodAtNode(sim.world, 5, 5, STONE)).toBe(stone);
    expect(resourceOfGoodAtNode(sim.world, 6, 5, WOOD)).toBeNull();
  });

  it('surfaces the runner-up when the winner is destroyed between reads (incremental removal)', () => {
    const sim = newSim();
    const winner = resourceAt(sim, 7, 7, WOOD);
    const runnerUp = resourceAt(sim, 7, 7, WOOD);
    expect(resourceOfGoodAtNode(sim.world, 7, 7, WOOD)).toBe(winner); // build the index
    sim.world.destroy(winner);
    expect(resourceOfGoodAtNode(sim.world, 7, 7, WOOD)).toBe(runnerUp);
    sim.world.destroy(runnerUp);
    expect(resourceOfGoodAtNode(sim.world, 7, 7, WOOD)).toBeNull();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('re-keys the good when a Resource row is overwritten in place (a journaled re-add)', () => {
    const sim = newSim();
    const e = resourceAt(sim, 9, 9, WOOD);
    expect(resourceOfGoodAtNode(sim.world, 9, 9, WOOD)).toBe(e);
    sim.world.add(e, Resource, { goodType: STONE, remaining: 3, harvestAtomic: ATOMIC });
    stampResourceFootprintData(sim.world, e, anchorOnlyFootprint());
    expect(resourceOfGoodAtNode(sim.world, 9, 9, WOOD)).toBeNull();
    expect(resourceOfGoodAtNode(sim.world, 9, 9, STONE)).toBe(e);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
