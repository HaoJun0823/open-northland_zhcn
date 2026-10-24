import { LEGACY_HOUSE_NAMES } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { type AuthoredJoinRows, contentJoins } from '../../src/game/world/index.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('the legacy house names over the served house table', () => {
  const rows = rawIrUnderTest() as AuthoredJoinRows;
  const defined = new Set((rows.buildingBobs ?? []).map((b) => b.editName?.toLowerCase()));

  it('maps only names the table lacks, each onto a house it defines', () => {
    for (const [legacy, target] of LEGACY_HOUSE_NAMES) {
      expect(defined.has(legacy), legacy).toBe(false);
      expect(defined.has(target), target).toBe(true);
    }
  });

  it('joins every legacy name as its house, by name and level and by name alone', () => {
    const joins = contentJoins(rows);
    for (const [legacy, target] of LEGACY_HOUSE_NAMES) {
      const level = (rows.buildingBobs ?? []).find((b) => b.editName?.toLowerCase() === target)?.level ?? 0;
      expect(joins.buildingBob(legacy, level), legacy).toEqual(joins.buildingBob(target, level));
      expect(joins.buildingType(target), target).toBeDefined();
      expect(joins.buildingType(legacy), legacy).toBe(joins.buildingType(target));
    }
  });
});
