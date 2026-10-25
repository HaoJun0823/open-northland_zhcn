import { describe, expect, it } from 'vitest';
import { buildTerrainGraph, fx, HALF_COLUMN, nodeLatticeDistance } from '../../../src/index.js';
import { latticeOffsetDistance, latticeOffsetFloor } from '../../../src/nav/terrain/index.js';
import { ROW_EDGE } from '../../../src/nav/world-metric.js';
import { testContent } from '../../fixtures/content.js';
import { stepDijkstra } from '../../fixtures/step-dijkstra.js';
import { rawGrid } from './support.js';

/** An open grid wide enough that a walk from its middle to any node in the checked box never touches
 *  the border, and the two middle rows it is walked from. */
const OPEN_SIDE = 41;
const MIDDLE = OPEN_SIDE >> 1;
const CHECK_REACH = 12;
/** Offsets the floor is checked over, from a start row of either parity. */
const FLOOR_SPAN = 30;
const EVEN_ROW = 0;
const ODD_ROW = 1;

describe('nodeLatticeDistance', () => {
  it('prices a sideways offset as a row-crossing edge per half-row plus the half-columns left over', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // (0,0)->(5,3): eleven quarter columns and three half-rows - three edges and four half-columns.
    const threeRowsFourColumns = fx.add(fx.mulInt(ROW_EDGE, 3), fx.mulInt(HALF_COLUMN, 4));
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(5, 3))).toBe(threeRowsFourColumns);
    // From an odd row the same eleven quarter columns: (1,3)->(7,6).
    expect(nodeLatticeDistance(g, g.nodeAt(1, 3), g.nodeAt(7, 6))).toBe(threeRowsFourColumns);
    // Pure E: (0,0)->(4,0) = four half-columns = two full columns.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(4, 0))).toBe(fx.fromInt(2));
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 0))).toBe(fx.fromInt(0));
  });

  it('prices a climb no wider than its rows as one row-crossing edge per half-row', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    expect(nodeLatticeDistance(g, g.nodeAt(2, 0), g.nodeAt(2, 4))).toBe(fx.mulInt(ROW_EDGE, 4));
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 4))).toBe(fx.mulInt(ROW_EDGE, 4));
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 3))).toBe(fx.mulInt(ROW_EDGE, 3));
  });

  it('prices every row-crossing edge alike, whichever way its row leans, the same from either end', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    expect(nodeLatticeDistance(g, g.nodeAt(1, 0), g.nodeAt(0, 1))).toBe(ROW_EDGE);
    expect(nodeLatticeDistance(g, g.nodeAt(1, 0), g.nodeAt(1, 1))).toBe(ROW_EDGE);
    expect(nodeLatticeDistance(g, g.nodeAt(0, 1), g.nodeAt(1, 2))).toBe(ROW_EDGE);
    // Three quarter columns across one half-row: an edge and a half-column.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 1))).toBe(fx.add(HALF_COLUMN, ROW_EDGE));
    expect(nodeLatticeDistance(g, g.nodeAt(1, 1), g.nodeAt(0, 0))).toBe(fx.add(HALF_COLUMN, ROW_EDGE));
  });

  it('equals the cheapest walk over the graph steps from an even and from an odd row', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(OPEN_SIDE, OPEN_SIDE));
    for (const fromY of [MIDDLE, MIDDLE + 1]) {
      const from = g.nodeAt(MIDDLE, fromY);
      const walked = stepDijkstra(g, from);
      for (let y = fromY - CHECK_REACH; y <= fromY + CHECK_REACH; y++) {
        for (let x = MIDDLE - CHECK_REACH; x <= MIDDLE + CHECK_REACH; x++) {
          const to = g.nodeAt(x, y);
          expect(nodeLatticeDistance(g, from, to), `(${MIDDLE},${fromY}) -> (${x},${y})`).toBe(
            walked.get(to),
          );
          expect(nodeLatticeDistance(g, to, from)).toBe(walked.get(to));
        }
      }
    }
  });
});

describe('latticeOffsetFloor', () => {
  it('bounds the distance of every offset at least as far on both axes, whichever way it leans', () => {
    for (let ax = 0; ax <= FLOOR_SPAN; ax++) {
      for (let ay = 0; ay <= FLOOR_SPAN; ay++) {
        const floor = latticeOffsetFloor(ax, ay);
        for (const fromY of [EVEN_ROW, ODD_ROW]) {
          expect(floor).toBeLessThanOrEqual(latticeOffsetDistance(ax, ay, fromY));
          expect(floor).toBeLessThanOrEqual(latticeOffsetDistance(-ax, ay, fromY));
        }
        // Monotone in both offsets, so the nearest corner of a box bounds the whole box.
        expect(floor).toBeLessThanOrEqual(latticeOffsetFloor(ax + 1, ay));
        expect(floor).toBeLessThanOrEqual(latticeOffsetFloor(ax, ay + 1));
      }
    }
  });
});
