import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/component.js';
import { EntityMemberships } from '../../src/ecs/memberships.js';
import { PAGE_SIZE } from '../../src/ecs/paged-blocks.js';

function carried(m: EntityMemberships, e: Entity): number[] {
  const out: number[] = [];
  for (let i = m.next(e, -1); i >= 0; i = m.next(e, i)) out.push(i);
  return out;
}

describe('entity memberships', () => {
  it('walks carried indices ascending, across words and after a widening', () => {
    const m = new EntityMemberships();
    const a = 3 as Entity;
    const b = 70 as Entity;
    m.add(a, 5);
    m.add(a, 0);
    m.add(b, 31);
    // Index 70 needs a third word: every held mask is re-laid and keeps its bits.
    m.add(a, 70);
    m.add(a, 33);
    expect(carried(m, a)).toEqual([0, 5, 33, 70]);
    expect(carried(m, b)).toEqual([31]);
    expect(m.has(a, 33)).toBe(true);
    expect(m.has(b, 33)).toBe(false);
    m.remove(a, 5);
    expect(carried(m, a)).toEqual([0, 33, 70]);
    m.clear(a);
    expect(carried(m, a)).toEqual([]);
    const pairs: Array<[number, number]> = [];
    m.forEachCarried((e, i) => pairs.push([e, i]));
    expect(pairs).toEqual([[70, 31]]);
  });

  it('hands an emptied page block to the next page with every mask clear', () => {
    const m = new EntityMemberships();
    m.add(1 as Entity, 4);
    m.remove(1 as Entity, 4);
    const far = 100_000 as Entity;
    m.add(far, 2);
    expect(carried(m, far)).toEqual([2]);
    expect(carried(m, 1 as Entity)).toEqual([]);
    const pageStart = far - (far % PAGE_SIZE);
    for (let e = pageStart; e < pageStart + PAGE_SIZE; e++) {
      if (e !== far) expect(carried(m, e as Entity)).toEqual([]);
    }
  });

  it('removing an index the entity does not carry keeps its neighbour block', () => {
    const m = new EntityMemberships();
    const kept = 2 as Entity;
    const neighbour = (kept + 1) as Entity;
    const nextPage = (kept + PAGE_SIZE) as Entity;
    m.add(kept, 1);
    m.remove(neighbour, 1);
    m.add(nextPage, 0);
    expect(carried(m, kept)).toEqual([1]);
    expect(carried(m, nextPage)).toEqual([0]);
  });

  it('carries far-apart ids beside a low one', () => {
    const m = new EntityMemberships();
    const ids = [1, 10_000_000, 0x7fff0000] as Entity[];
    for (const [i, e] of ids.entries()) m.add(e, i);
    for (const [i, e] of ids.entries()) expect(carried(m, e)).toEqual([i]);
    const pairs: Array<[number, number]> = [];
    m.forEachCarried((e, i) => pairs.push([e, i]));
    expect(pairs).toEqual(ids.map((e, i) => [e, i]));
  });
});
