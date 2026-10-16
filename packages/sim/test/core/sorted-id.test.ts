import { describe, expect, it } from 'vitest';
import { includesSortedId, insertSortedById, removeSortedById } from '../../src/core/sorted-id.js';

const idOf = (id: number): number => id;

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
});
