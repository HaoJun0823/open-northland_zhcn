import { describe, expect, it, vi } from 'vitest';
import { MoveGoal } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { GRASS, orderTo, P0, SOLDIER, settlerAt, WATER } from './separation/support.js';

/** Whether the census captures every mover's goal and heading up front instead of on first ask. */
const capture = vi.hoisted(() => ({ eager: false }));

vi.mock('../../src/systems/movement/collision/separation/colliders.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../src/systems/movement/collision/separation/colliders.js')>();
  return {
    ...real,
    collectColliders: (...args: Parameters<typeof real.collectColliders>): boolean => {
      const walking = real.collectColliders(...args);
      const [world, , , scratch] = args;
      if (walking && capture.eager) {
        for (let slot = 0; slot < scratch.movers.count; slot++) {
          real.moverGoal(world, scratch, slot);
          real.moverHeading(world, scratch, slot);
        }
      }
      return walking;
    },
  };
});

/** Ticks two fighters meeting head-on in a one-row corridor grind before both stand down. */
const STAND_DOWN_BY = 200;

/** A water map with a one-cell grass corridor along its middle row. */
function corridorSim(widthCells: number): Simulation {
  const heightCells = 3;
  const typeIds = new Array<number>(widthCells * heightCells).fill(WATER);
  typeIds.fill(GRASS, widthCells, 2 * widthCells);
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: halfCellMapFromCells({ width: widthCells, height: heightCells, typeIds }),
  });
}

/** Two same-side fighters ordered through each other along the corridor; returns the state hash per tick
 *  and the tick each lost its goal. */
function headOn(eager: boolean): { hashes: string[]; stoodDown: (number | null)[] } {
  capture.eager = eager;
  const s = corridorSim(16);
  const row = 2;
  const low: Entity = settlerAt(s, 14, row, SOLDIER, P0);
  const high: Entity = settlerAt(s, 8, row, SOLDIER, P0);
  orderTo(s, low, 2, row);
  orderTo(s, high, 24, row);
  const hashes: string[] = [];
  const stoodDown: (number | null)[] = [null, null];
  for (let tick = 1; tick <= STAND_DOWN_BY; tick++) {
    s.step();
    hashes.push(String(s.hashState()));
    [low, high].forEach((e, i) => {
      if (stoodDown[i] === null && !s.world.has(e, MoveGoal)) stoodDown[i] = tick;
    });
  }
  capture.eager = false;
  return { hashes, stoodDown };
}

describe('unit body collision - first-ask capture', () => {
  it('plays a grind that stands the lower id down beside a higher id as an eager census would', () => {
    const lazy = headOn(false);
    const eager = headOn(true);
    // The lower id stands down first, while the higher id still grinds against it.
    const [lowDown, highDown] = lazy.stoodDown;
    if (lowDown === null || lowDown === undefined || highDown === null || highDown === undefined)
      throw new Error('both fighters stand down inside the run');
    expect(lowDown).toBeLessThan(highDown);
    expect(lazy.stoodDown).toEqual(eager.stoodDown);
    expect(lazy.hashes).toEqual(eager.hashes);
  });
});
