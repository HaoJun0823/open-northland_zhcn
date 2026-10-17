import { describe, expect, it } from 'vitest';
import type { GroupMemberModel } from '../src/hud/details-panel/model/index.js';
import { rosterRows, rosterRowsOf, rowsInView } from '../src/hud/dom/group-panel/members.js';

const member = (look: GroupMemberModel['look']): GroupMemberModel => ({
  id: 0,
  look,
  kind: look,
  name: '',
  kindLabel: '',
  healthPct: null,
  hungerPct: null,
  carriesMead: false,
});

describe('roster rows', () => {
  it('fills a row with settlers and lets a vehicle that would cross its end start the next', () => {
    const settlers = (n: number) => Array.from({ length: n }, () => member('settler'));
    expect(rosterRows([], 8)).toBe(0);
    expect(rosterRows(settlers(8), 8)).toBe(1);
    expect(rosterRows(settlers(9), 8)).toBe(2);
    expect(rosterRows([...settlers(7), member('vehicle')], 8)).toBe(2);
    expect(rosterRows([...settlers(6), member('vehicle')], 8)).toBe(1);
  });

  it('places each member on its row, a vehicle that would cross the end on the next', () => {
    const settlers = (n: number) => Array.from({ length: n }, () => member('settler'));
    expect(rosterRowsOf([...settlers(7), member('vehicle'), member('settler')], 8)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 1, 1,
    ]);
  });
});

describe('roster rows in view', () => {
  const PITCH = { row: 46, gap: 3 };
  const STEP = PITCH.row + PITCH.gap;

  it('takes every row whose box meets the view, as an offset test against the scroll box would', () => {
    expect(rowsInView(PITCH, 4, 0)).toEqual({ first: 0, last: 3 });
    // Scrolled through the gap under the fourth row, the fifth row's top shows at the view's bottom edge.
    expect(rowsInView(PITCH, 4, PITCH.gap)).toEqual({ first: 0, last: 3 });
    expect(rowsInView(PITCH, 4, PITCH.gap + 1)).toEqual({ first: 0, last: 4 });
    // Scrolled past the first row's box, though not its gap.
    expect(rowsInView(PITCH, 4, PITCH.row)).toEqual({ first: 1, last: 4 });
    expect(rowsInView(PITCH, 4, 10 * STEP)).toEqual({ first: 10, last: 13 });
  });

  it('counts every row as shown before the grid has its styles', () => {
    expect(rowsInView({ row: 0, gap: 0 }, 4, 0).first).toBe(0);
    expect(rowsInView({ row: 0, gap: 0 }, 4, 0).last).toBe(Number.MAX_SAFE_INTEGER);
  });
});
