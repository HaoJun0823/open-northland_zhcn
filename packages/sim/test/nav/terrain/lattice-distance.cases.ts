import { describe, expect, it } from 'vitest';
import {
  buildTerrainGraph,
  DIAGONAL_STEP,
  fx,
  HALF_COLUMN,
  HALF_ROW,
  nodeLatticeDistance,
} from '../../../src/index.js';
import { latticeOffsetDistance, latticeOffsetFloor } from '../../../src/nav/terrain/index.js';
import { SLANT_STEP } from '../../../src/nav/world-metric.js';
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
  it('prices a sideways-dominant offset with all rows crossed diagonally plus half-column steps', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // (0,0)->(5,3): ax=5, ay=3 → ⌊3/2⌋=1 diagonal + 4 half-columns + the odd leftover half-row. The slant
    // from an even row leads west, so eastward it saves nothing.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(5, 3))).toBe(
      fx.add(fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(4), HALF_COLUMN)), HALF_ROW),
    );
    // From an odd row the slant leads east: (1,3)->(6,6) replaces one half-column and the odd half-row.
    expect(nodeLatticeDistance(g, g.nodeAt(1, 3), g.nodeAt(6, 6))).toBe(
      fx.add(fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(3), HALF_COLUMN)), SLANT_STEP),
    );
    // Pure E: (0,0)->(4,0) = four half-columns = two full columns.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(4, 0))).toBe(fx.fromInt(2));
    // The diagonal edge itself: (0,0)->(1,2).
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 2))).toBe(DIAGONAL_STEP);
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 0))).toBe(fx.fromInt(0));
  });

  it('prices a vertical-dominant offset with straight half-row steps, diagonals only for the offset', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // Straight down the screen, (2,0)->(2,4): four half-row steps, no weave premium.
    expect(nodeLatticeDistance(g, g.nodeAt(2, 0), g.nodeAt(2, 4))).toBe(fx.mul(fx.fromInt(4), HALF_ROW));
    // (0,0)->(1,4): 2·ax=2 ≤ ay=4 - one diagonal absorbs the column, two half-rows remain.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 4))).toBe(
      fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(2), HALF_ROW)),
    );
    // (0,0)->(0,3): three straight half-rows.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 3))).toBe(fx.mul(fx.fromInt(3), HALF_ROW));
  });

  it('prices the slant edge itself only the way the row leans, the same from either end', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // Even rows slant west, odd rows east.
    expect(nodeLatticeDistance(g, g.nodeAt(1, 0), g.nodeAt(0, 1))).toBe(SLANT_STEP);
    expect(nodeLatticeDistance(g, g.nodeAt(0, 1), g.nodeAt(1, 2))).toBe(SLANT_STEP);
    // The other way is a half-column and a half-row, no edge joins them directly.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 1))).toBe(fx.add(HALF_COLUMN, HALF_ROW));
    expect(nodeLatticeDistance(g, g.nodeAt(1, 1), g.nodeAt(0, 0))).toBe(fx.add(HALF_COLUMN, HALF_ROW));
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
