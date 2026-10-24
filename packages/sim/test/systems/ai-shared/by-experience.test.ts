import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/ecs/world.js';
import { byExperience } from '../../../src/systems/ai-shared/workforce/experience.js';

const MAX_STAFF = 40;
/** Coprime with {@link ID_SPAN}, so the ids below are distinct and out of order. */
const ID_STRIDE = 37;
const ID_SPAN = 101;
const RANK_SPREAD = 5;

describe('byExperience', () => {
  it('orders most experienced first, ascending id on ties, like a plain sort', () => {
    const rank = (e: Entity): number => e % RANK_SPREAD;
    for (let n = 0; n <= MAX_STAFF; n++) {
      const staff = Array.from({ length: n }, (_, i) => ((i * ID_STRIDE) % ID_SPAN) as Entity);
      const expected = [...staff].sort((a, b) => rank(b) - rank(a) || a - b);
      expect(byExperience(staff, rank)).toBe(staff);
      expect(staff).toEqual(expected);
    }
  });
});
