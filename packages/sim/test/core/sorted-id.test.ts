import { describe, expect, it } from 'vitest';
import { includesSortedId, insertSortedById, removeSortedById } from '../../src/core/sorted-id.js';

const idOf = (id: number): number => id;
/** The shift length up to which sorted-id.ts moves items by hand instead of `splice`. */
const HAND_SHIFT_LIMIT = 128;

describe('sorted id lists', () => {
  it.each([8, 400])('stay ascending through middle inserts and removes on a %i-item list', (size) => {
    const list: number[] = [];
    for (let id = 0; id < size; id++) insertSortedById(list, id * 2, idOf);
    for (let id = size - 1; id >= 0; id--) insertSortedById(list, id * 2 + 1, idOf);
    expect(list).toEqual(Array.from({ length: size * 2 }, (_, i) => i));
    for (let id = 0; id < size * 2; id += 3) expect(removeSortedById(list, id, idOf)).toBe(true);
    expect(removeSortedById(list, 0, idOf)).toBe(false);
    const kept = Array.from({ length: size * 2 }, (_, i) => i).filter((id) => id % 3 !== 0);
    expect(list).toEqual(kept);
    expect(includesSortedId(list, 1, idOf)).toBe(true);
    expect(includesSortedId(list, 3, idOf)).toBe(false);
  });

  it('inserts at index 0 of a 400-item list', () => {
    const size = 400;
    const list = Array.from({ length: size }, (_, i) => i + 1);
    insertSortedById(list, 0, idOf);
    expect(list).toEqual(Array.from({ length: size + 1 }, (_, i) => i));
  });

  it.each([HAND_SHIFT_LIMIT, HAND_SHIFT_LIMIT + 1])(
    'inserts and removes with %i items behind the slot',
    (behind) => {
      const list = Array.from({ length: behind + 1 }, (_, i) => i * 2);
      insertSortedById(list, 1, idOf);
      const expected = [0, 1, ...Array.from({ length: behind }, (_, i) => (i + 1) * 2)];
      expect(list).toEqual(expected);
      expect(removeSortedById(list, 1, idOf)).toBe(true);
      expect(list).toEqual(expected.filter((id) => id !== 1));
    },
  );
});
