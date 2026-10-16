import { describe, expect, it } from 'vitest';
import { NodeChangeStamps } from '../../src/nav/change-stamps.js';

const SIDE = 40;
const WHOLE = { minHx: 0, maxHx: SIDE - 1, minHy: 0, maxHy: SIDE - 1 };
const ANY = (): boolean => true;
/** A clock past what an Int32 stamp holds above a zero base. */
const PAST_INT32 = 2 ** 31 + 5;

describe('NodeChangeStamps', () => {
  it('reports only stamps after the reader clock', () => {
    const stamps = new NodeChangeStamps(SIDE, SIDE);
    expect(stamps.anyChangedSince(WHOLE, 0, ANY)).toBe(false);
    stamps.stamp(3, 4, 7);
    expect(stamps.anyChangedSince(WHOLE, 6, ANY)).toBe(true);
    expect(stamps.anyChangedSince(WHOLE, 7, ANY)).toBe(false);
    expect(stamps.anyChangedSince(WHOLE, 6, (x, y) => x !== 3 || y !== 4)).toBe(false);
  });

  it('tests only the changed nodes, in row order, and skips the unchanged rows of a changed block', () => {
    const stamps = new NodeChangeStamps(SIDE, SIDE);
    stamps.stamp(9, 5, 3);
    stamps.stamp(2, 5, 4);
    stamps.stamp(4, 1, 5);
    stamps.stamp(30, 33, 6);
    const tested: string[] = [];
    const record = (x: number, y: number): boolean => {
      tested.push(`${x},${y}`);
      return false;
    };
    expect(stamps.anyChangedSince(WHOLE, 3, record)).toBe(false);
    expect(tested).toEqual(['4,1', '2,5', '30,33']);
  });

  it('keeps exact readings for clocks past Int32 and over-reports only older readers', () => {
    const stamps = new NodeChangeStamps(SIDE, SIDE);
    stamps.stamp(1, 1, 1);
    stamps.stamp(2, 2, PAST_INT32);
    expect(stamps.anyChangedSince(WHOLE, PAST_INT32 - 1, (x) => x === 2)).toBe(true);
    expect(stamps.anyChangedSince(WHOLE, PAST_INT32, ANY)).toBe(false);
    stamps.stamp(5, 5, PAST_INT32 + 1);
    expect(stamps.anyChangedSince(WHOLE, PAST_INT32, (x) => x === 5)).toBe(true);
    expect(stamps.anyChangedSince(WHOLE, PAST_INT32, (x) => x === 2)).toBe(false);
    // A reader from before the rebase sees every node as changed, the safe side for a cache.
    expect(stamps.anyChangedSince(WHOLE, 1, (x) => x === 1)).toBe(true);
  });
});
