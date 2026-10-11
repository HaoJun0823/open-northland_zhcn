import { describe, expect, it } from 'vitest';
import { Carrying, Position, Stockpile, setStockAmount } from '../../src/components/index.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import { collectTargets, nearestFreeYardNode } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import {
  bindToFlag,
  ctxOf,
  grassMap,
  groundHeaps,
  makeWoodcutter,
  runTicks,
  WIDE_RADIUS,
  WOOD,
} from './gatherer-flag/support.js';

function fixture(row = 10) {
  const sim = new Simulation({ seed: 23, content: testContent(), map: grassMap(30, 30) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing yard terrain');
  const worker = makeWoodcutter(sim, 3, 3);
  const flag = bindToFlag(sim, worker, 0, 0, WIDE_RADIUS);
  sim.world.add(flag, Position, positionOfNode(10, row));
  const here = terrain.nodeAt(6, 6);
  const pick = (after?: ReturnType<typeof terrain.nodeAt>) =>
    nearestFreeYardNode(
      collectTargets(sim.world, ctxOf(sim), terrain).yard,
      sim.world,
      terrain,
      flag,
      WOOD,
      here,
      after,
    );
  const heap = (hx: number, hy: number, fill = 5, good = WOOD) => {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(hx, hy));
    sim.world.add(e, Stockpile, { amounts: new Map([[good, fill]]) });
    return e;
  };
  return { sim, terrain, worker, flag, pick, heap };
}

describe('flag yard layout approximation', () => {
  it.each([10, 11])('fills the flag, then six neighbours in clockwise order on row %i', (row) => {
    const { terrain, pick, heap } = fixture(row);
    const westDiagonal = row % 2 === 0 ? 9 : 10;
    const eastDiagonal = westDiagonal + 1;
    const expected = [
      [10, row],
      [11, row],
      [eastDiagonal, row + 1],
      [westDiagonal, row + 1],
      [9, row],
      [westDiagonal, row - 1],
      [eastDiagonal, row - 1],
      [12, row],
    ];
    for (const [hx, hy] of expected) {
      if (hx === undefined || hy === undefined) throw new Error('missing expected point');
      expect(pick()).toBe(terrain.nodeAt(hx, hy));
      heap(hx, hy);
    }
  });

  it('tops up the centre and reuses a drained inner heap before expanding', () => {
    const { sim, terrain, pick, heap } = fixture();
    const centre = heap(10, 10, 4);
    expect(pick()).toBe(terrain.nodeAt(10, 10));
    setStockAmount(sim.world, centre, WOOD, 5);
    const east = heap(11, 10);
    expect(pick()).toBe(terrain.nodeAt(10, 11));
    setStockAmount(sim.world, east, WOOD, 0);
    expect(pick()).toBe(terrain.nodeAt(11, 10));
  });

  it('resumes after an unreachable candidate in layout order, even at a lower node id', () => {
    const { terrain, pick, heap } = fixture();
    heap(10, 10);
    heap(11, 10, 1, WOOD + 1);
    expect(pick()).toBe(terrain.nodeAt(10, 11));
    expect(pick(terrain.nodeAt(10, 11))).toBe(terrain.nodeAt(9, 11));
    expect(pick(terrain.nodeAt(9, 11))).toBe(terrain.nodeAt(9, 10));
  });

  it('skips off-map neighbours without changing the order of the remaining candidates', () => {
    const { sim, terrain, flag, pick, heap } = fixture();
    sim.world.add(flag, Position, positionOfNode(0, 0));
    heap(0, 0);
    heap(1, 0);
    expect(pick()).toBe(terrain.nodeAt(0, 1));
    heap(0, 1);
    expect(pick()).toBe(terrain.nodeAt(2, 0));
  });

  it('walks each delivery to its pile and repeats the same layout and state with the same seed', () => {
    const run = () => {
      const { sim, worker } = fixture();
      for (let load = 0; load < 11; load++) {
        sim.world.add(worker, Carrying, { goodType: WOOD, amount: 1 });
        expect(runTicks(sim, 200)).toEqual([]);
        expect(sim.world.has(worker, Carrying)).toBe(false);
      }
      const heaps = groundHeaps(sim).map((e) => {
        const p = sim.world.get(e, Position);
        return { ...nodeOfPosition(p.x, p.y), fill: sim.world.get(e, Stockpile).amounts.get(WOOD) };
      });
      expect(heaps).toEqual([
        { hx: 10, hy: 10, fill: 5 },
        { hx: 11, hy: 10, fill: 5 },
        { hx: 10, hy: 11, fill: 1 },
      ]);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
