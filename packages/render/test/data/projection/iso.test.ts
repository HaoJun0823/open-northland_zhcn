import { positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  halfCellToScreen,
  ONE,
  screenToHalfCell,
  screenToHalfCellSum,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
} from '../../../src/data/projection/index.js';

describe('halfCellToScreen', () => {
  it('draws an odd node row a quarter cell right of the even rows', () => {
    expect(halfCellToScreen(4, 6).x).toBe(4 * TILE_HALF_W);
    expect(halfCellToScreen(4, 7).x).toBe(4 * TILE_HALF_W + TILE_HALF_W / 2);
  });

  it('lands where a sim position standing on the node projects', () => {
    for (const [hx, hy] of [
      [4, 6],
      [4, 7],
      [5, 8],
      [5, 9],
    ] as const) {
      const p = positionOfNode(hx, hy);
      expect(tileToScreen(p.x / ONE, p.y / ONE)).toEqual(halfCellToScreen(hx, hy));
    }
  });

  it('is inverted exactly by screenToHalfCell', () => {
    for (let hy = 0; hy < 6; hy++) {
      for (let hx = 0; hx < 6; hx++) {
        const p = halfCellToScreen(hx, hy);
        expect(screenToHalfCell(p.x, p.y)).toEqual({ col: hx, row: hy });
      }
    }
  });

  it('picks the nearest node of either row for a point between rows', () => {
    // Under the midpoint of even-row nodes 0 and 1 and above the half-row line, yet nearer the odd-row
    // node below than either even-row node beside it.
    const odd = halfCellToScreen(0, 1);
    const nearRow = TILE_HALF_H / 4 - 1;
    expect(screenToHalfCell(odd.x, nearRow)).toEqual({ col: 0, row: 1 });
  });

  it('sums the nearest node like screenToHalfCell, without the object', () => {
    // A stride off the lattice period probes many offsets within a node box, negative ones included.
    const stride = 3.7;
    for (let y = -2 * TILE_HALF_H; y < 4 * TILE_HALF_H; y += stride) {
      for (let x = -2 * TILE_HALF_W; x < 4 * TILE_HALF_W; x += stride) {
        const node = screenToHalfCell(x, y);
        expect(screenToHalfCellSum(x, y)).toBe(node.col + node.row);
      }
    }
  });
});
