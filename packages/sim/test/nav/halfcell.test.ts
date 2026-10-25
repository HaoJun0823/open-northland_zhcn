import { describe, expect, it } from 'vitest';
import {
  cellAnchorNode,
  cellOfAnchorNode,
  cellOfNode,
  fx,
  type HalfCellNode,
  hexNeighboursOf,
  nodeOfPosition,
  ONE,
  positionOfNode,
} from '../../src/index.js';
import { nodeWorldX, positionXOfWorld } from '../../src/nav/halfcell.js';

/**
 * The half-cell ↔ Position conversion seam (`nav/halfcell.ts`) - the one place a fractional
 * fixed-point Position becomes an integer node address and back. These pin the exact geometry the
 * whole grid vocabulary hangs on: cell (c,r) = node (2c+(r&1), 2r), a rectangular node lattice in
 * world space, quarters exact in fixed point.
 */

const Q = (n: number): number => (n * ONE) / 4; // exact quarter-tiles (ONE is divisible by 4)

describe('cellAnchorNode', () => {
  it('maps a visual cell to its centre node with the row-parity stagger made integral', () => {
    expect(cellAnchorNode(0, 0)).toEqual({ hx: 0, hy: 0 });
    expect(cellAnchorNode(3, 2)).toEqual({ hx: 6, hy: 4 }); // even row: no shift
    expect(cellAnchorNode(3, 5)).toEqual({ hx: 7, hy: 10 }); // odd row: half-cell right
  });
});

describe('cellOfAnchorNode', () => {
  it('inverts cellAnchorNode for both row parities', () => {
    expect(cellOfAnchorNode(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(cellOfAnchorNode(6, 4)).toEqual({ cx: 3, cy: 2 });
    expect(cellOfAnchorNode(7, 10)).toEqual({ cx: 3, cy: 5 }); // odd row: parity undone
  });

  it('round-trips every cell in a block spanning both parities', () => {
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const { hx, hy } = cellAnchorNode(cx, cy);
        expect(cellOfAnchorNode(hx, hy)).toEqual({ cx, cy });
      }
    }
  });
});

describe('cellOfNode', () => {
  it('agrees with cellOfAnchorNode on every centre node', () => {
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const { hx, hy } = cellAnchorNode(cx, cy);
        expect(cellOfNode(hx, hy)).toEqual({ cx, cy });
      }
    }
  });

  it('settles a between-row node the original`s way: right below an even cell row, straight below an odd one', () => {
    // hy % 4 == 1: the row under an even cell row nudges one node right before halving.
    expect(cellOfNode(3, 1)).toEqual({ cx: 2, cy: 0 });
    expect(cellOfNode(2, 1)).toEqual({ cx: 1, cy: 0 });
    // hy % 4 == 3: the row under an odd cell row halves as is.
    expect(cellOfNode(2, 3)).toEqual({ cx: 1, cy: 1 });
    expect(cellOfNode(3, 3)).toEqual({ cx: 1, cy: 1 });
    // hy % 4 == 2: an odd cell row's own anchor row nudges one left, so its off-centre node stays in the row's cell.
    expect(cellOfNode(4, 2)).toEqual({ cx: 1, cy: 1 });
  });
});

describe('positionOfNode', () => {
  it('is exactly the cell centre for a cell-anchored node', () => {
    for (const [cx, cy] of [
      [0, 0],
      [3, 2],
      [3, 5],
      [7, 1],
    ] as const) {
      const { hx, hy } = cellAnchorNode(cx, cy);
      expect(positionOfNode(hx, hy)).toEqual({ x: fx.fromInt(cx), y: fx.fromInt(cy) });
    }
  });

  it('places off-centre nodes at exact quarter-tile positions (stagger removed per row)', () => {
    // Node (1,0): the E-mid node of cell (0,0) - even row, no stagger: x = ½.
    expect(positionOfNode(1, 0)).toEqual({ x: Q(2), y: Q(0) });
    // Node (0,2): row 1 (odd, stagger ½): x = 0 − ½ = −½ - the west-border seam transient.
    expect(positionOfNode(0, 2)).toEqual({ x: Q(-2), y: fx.fromInt(1) });
    // Node (2,1): an odd row, world 1 + ¼; row ½ (stagger ¼): x = 1¼ − ¼ = 1.
    expect(positionOfNode(2, 1)).toEqual({ x: Q(4), y: Q(2) });
  });
});

describe('nodeOfPosition', () => {
  it('round-trips every node of a small grid exactly', () => {
    for (let hy = 0; hy < 8; hy++) {
      for (let hx = 1; hx < 8; hx++) {
        // hx ≥ 1: node (0, hy) on an odd row sits at world x < 0 (the border seam) and legitimately
        // truncates to hx 0 only via clamping - covered by the border case below.
        const p = positionOfNode(hx, hy);
        expect(nodeOfPosition(p.x, p.y)).toEqual({ hx, hy });
      }
    }
  });

  it('truncates a mid-leg position onto the node behind it (floor-until-arrival)', () => {
    // A walker at (0.4, 0): world x 0.4 → 2·0.4 = 0.8 truncates to node 0; row 0 → hy 0.
    expect(nodeOfPosition(fx.fromFloat(0.4), fx.fromInt(0))).toEqual({ hx: 0, hy: 0 });
    // At (0.6, 0) it has passed the E-mid node (1,0): 2·0.6 = 1.2 → hx 1.
    expect(nodeOfPosition(fx.fromFloat(0.6), fx.fromInt(0))).toEqual({ hx: 1, hy: 0 });
  });

  // A column step from (hx, hy) to (hx, hy + 2), sampled along its column line. Walked either way, the
  // walker reads the step's start before the skipped row and its destination after it.
  const SAMPLES_PER_ROW = 16;
  const columnStepNodes = (hx: number, hy: number): { hx: number; hy: number }[] => {
    const wx = nodeWorldX(hx, hy);
    const nodes: { hx: number; hy: number }[] = [];
    for (let i = 0; i <= 2 * SAMPLES_PER_ROW; i++) {
      const y = fx.add(
        fx.div(fx.fromInt(hy), fx.fromInt(2)),
        fx.div(fx.fromInt(i), fx.fromInt(2 * SAMPLES_PER_ROW)),
      );
      nodes.push(nodeOfPosition(positionXOfWorld(wx, y), y));
    }
    return nodes;
  };

  it.each([
    ['an even row', 6, 4],
    ['an odd row', 6, 5],
    ['an even row at hx 0', 0, 4],
    ['an odd row at hx 0', 0, 5],
  ])('reads a column step from %s as its start, then its destination', (_, hx, hy) => {
    const nodes = columnStepNodes(hx, hy);
    const middle = SAMPLES_PER_ROW;
    for (let i = 0; i < nodes.length; i++) {
      if (i === middle) continue;
      expect(nodes[i]).toEqual({ hx, hy: i < middle ? hy : hy + 2 });
    }
  });

  it('keeps the on-row rule on the skipped row, where the column crosses an E/W edge midway', () => {
    // Even row 4: the column at hx 6 crosses row 5 between (5, 5) and (6, 5), which truncates west.
    expect(columnStepNodes(6, 4)[SAMPLES_PER_ROW]).toEqual({ hx: 5, hy: 5 });
  });

  // Every edge and column step from a node of either row parity, at hx 0 too (negative Position x),
  // sampled strictly inside with a small offset across the line: the first half reads the start, the
  // second half the end, never a third node.
  const PERPENDICULAR_OFFSETS = [-0.02, 0, 0.02];
  const sampleNode = (from: HalfCellNode, to: HalfCellNode, t: number, offset: number): HalfCellNode => {
    const fromWx = fx.toFloat(nodeWorldX(from.hx, from.hy));
    const toWx = fx.toFloat(nodeWorldX(to.hx, to.hy));
    const along = from.hy === to.hy;
    const wx = fromWx + (toWx - fromWx) * t + (along ? 0 : offset);
    const y = fx.fromFloat((from.hy + (to.hy - from.hy) * t) / 2 + (along ? offset : 0));
    return nodeOfPosition(positionXOfWorld(fx.fromFloat(wx), y), y);
  };
  const steps = (hx: number, hy: number): HalfCellNode[] => [
    ...hexNeighboursOf(hx, hy),
    { hx, hy: hy - 2 },
    { hx, hy: hy + 2 },
  ];

  it.each([
    ['an even row', 6, 4],
    ['an odd row', 6, 5],
    ['an even row at hx 0', 0, 4],
    ['an odd row at hx 0', 0, 5],
  ])('reads every step from %s as its start, then its end from half progress', (_, hx, hy) => {
    const from = { hx, hy };
    for (const to of steps(hx, hy)) {
      for (const offset of PERPENDICULAR_OFFSETS) {
        for (const t of [0.1, 0.3, 0.4, 0.6, 0.7, 0.9]) {
          // An E/W edge keeps the on-row rule: its column floors, so only the exact row is pinned there.
          if (from.hy === to.hy && offset !== 0) continue;
          const expected = from.hy === to.hy ? (to.hx > hx ? from : to) : t < 0.5 ? from : to;
          expect(sampleNode(from, to, t, offset), `to ${to.hx},${to.hy} t ${t} offset ${offset}`).toEqual(
            expected,
          );
        }
      }
    }
  });

  it('floors a row above the map, so an off-map transient reads row -1', () => {
    const y = fx.fromFloat(-0.1);
    expect(nodeOfPosition(positionXOfWorld(nodeWorldX(4, -1), y), y).hy).toBe(-1);
  });
});
