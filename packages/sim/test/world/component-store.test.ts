import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/component.js';
import { ComponentStore } from '../../src/ecs/component-store.js';
import { defineComponent, World } from '../../src/ecs/world.js';

const Walked = defineComponent<number>('ComponentStoreWalked', 'economy');

/** A small LCG so the op sequences repeat without the sim's Rng. */
function lcg(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

const ENTITY_RANGE = 2000;
const OPS = 20_000;

describe('ComponentStore', () => {
  it('matches a Map in membership, values and insertion order through churn and compaction', () => {
    const next = lcg(7);
    const store = new ComponentStore<number>();
    const reference = new Map<Entity, number>();
    for (let op = 0; op < OPS; op++) {
      const e = (1 + next(ENTITY_RANGE)) as Entity;
      if (next(3) === 0) {
        expect(store.delete(e)).toBe(reference.delete(e));
      } else {
        expect(store.set(e, op)).toBe(!reference.has(e));
        reference.set(e, op);
      }
    }
    expect(store.size).toBe(reference.size);
    expect(store.keys()).toEqual([...reference.keys()]);
    expect([...store.entries()]).toEqual([...reference.entries()]);
    for (let e = 1; e <= ENTITY_RANGE; e++) {
      expect(store.get(e as Entity)).toBe(reference.get(e as Entity));
      expect(store.has(e as Entity)).toBe(reference.has(e as Entity));
    }
  });

  it('a query walk sees removals, re-adds and compactions mid-walk exactly like a Map iterator', () => {
    const next = lcg(11);
    const world = new World();
    const reference = new Map<Entity, number>();
    const ids: Entity[] = [];
    for (let i = 0; i < ENTITY_RANGE; i++) {
      const e = world.create();
      ids.push(e);
      world.add(e, Walked, i);
      reference.set(e, i);
    }
    const mutate = (): void => {
      // Mostly removals, so vacated slots pile up and the store compacts under the open walk.
      for (let k = 0; k < 3; k++) {
        const e = ids[next(ids.length)];
        if (e === undefined) continue;
        if (next(4) === 0) {
          world.add(e, Walked, k);
          reference.set(e, k);
        } else {
          world.remove(e, Walked);
          reference.delete(e);
        }
      }
    };
    const walked: Entity[] = [];
    for (const e of world.query(Walked)) {
      walked.push(e);
      mutate();
    }
    const replay = lcg(11);
    const replayWorld = new Map<Entity, number>();
    for (let i = 0; i < ENTITY_RANGE; i++) replayWorld.set(ids[i] as Entity, i);
    const expected: Entity[] = [];
    for (const e of replayWorld.keys()) {
      expected.push(e);
      for (let k = 0; k < 3; k++) {
        const target = ids[replay(ids.length)];
        if (target === undefined) continue;
        if (replay(4) === 0) replayWorld.set(target, k);
        else replayWorld.delete(target);
      }
    }
    expect(walked).toEqual(expected);
    expect([...world.query(Walked)]).toEqual([...reference.keys()]);
  });
});
