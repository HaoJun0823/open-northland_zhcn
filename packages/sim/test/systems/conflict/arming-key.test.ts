import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { attackerWeapon } from '../../../src/systems/conflict/weapons.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

/** Ids at or past each arming key span: tribe 2^9, job and worn weapon 2^10. */
const WIDE_TRIBE = 512;
const WIDE_JOB = 1024;
const WIDE_WORN = 1500;

it('resolves the weapon of an id past its arming key span, uncached, as for any other id', () => {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [],
    buildings: [],
    jobs: [
      { typeId: 31, id: 'soldier' },
      { typeId: 32, id: 'archer' },
      { typeId: WIDE_JOB, id: 'wide_soldier' },
    ],
    weapons: [
      { typeId: 1, id: 'fist', tribeType: 1, jobType: 31, minRange: 1, maxRange: 1 },
      { typeId: 2, id: 'wide_fist', tribeType: WIDE_TRIBE, jobType: 31, minRange: 1, maxRange: 1 },
      { typeId: 3, id: 'wide_axe', tribeType: 1, jobType: WIDE_JOB, minRange: 1, maxRange: 1 },
      { typeId: WIDE_WORN, id: 'wide_bow', tribeType: 1, jobType: 32, minRange: 3, maxRange: 17 },
    ],
  });
  const ctx = ctxOf(new Simulation({ content, seed: 7 }));
  for (let ask = 0; ask < 2; ask++) {
    expect(attackerWeapon(ctx, 1, 31)?.weapon.id).toBe('fist');
    expect(attackerWeapon(ctx, WIDE_TRIBE, 31)?.weapon.id).toBe('wide_fist');
    expect(attackerWeapon(ctx, 1, WIDE_JOB)?.weapon.id).toBe('wide_axe');
    expect(attackerWeapon(ctx, 1, 31, WIDE_WORN)?.weapon.id).toBe('wide_bow');
  }
});
