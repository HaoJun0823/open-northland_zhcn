import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * A batch lasts one playthrough of the produce clip the crafter's tribe binds, so the pack's ruling that
 * every nation crafts a good in the viking's time is a join over the real IR: each tribe's clip for a
 * good's produce atomic runs as long as the viking's clip for the same trade.
 */

const VIKING = 'viking';

describe.runIf(hasRealIr())('production timing over real content', () => {
  it('gives every nation the viking crafting time for each trade and good', () => {
    const ir = rawIrUnderTest() as ContentIr & {
      readonly goods?: readonly { id: string; atomics?: { produce?: number } }[];
    };
    const lengths = new Map((ir.atomicAnimations ?? []).map((a) => [a.name, a.length]));
    const produceAtomics = new Set(
      (ir.goods ?? []).flatMap((g) => (g.atomics?.produce === undefined ? [] : [g.atomics.produce])),
    );
    const key = (job: number, atomic: number): string => `${job}/${atomic}`;
    const viking = new Map<string, string>();
    for (const b of ir.tribes?.find((t) => t.id === VIKING)?.atomicBindings ?? [])
      if (produceAtomics.has(b.atomicId)) viking.set(key(b.jobType, b.atomicId), b.animation);
    expect(viking.size).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const tribe of ir.tribes ?? []) {
      for (const b of tribe.atomicBindings ?? []) {
        const reference = viking.get(key(b.jobType, b.atomicId));
        if (reference === undefined || lengths.get(b.animation) === lengths.get(reference)) continue;
        mismatches.push(
          `${tribe.id} ${b.animation} ${lengths.get(b.animation)} vs ${reference} ${lengths.get(reference)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
