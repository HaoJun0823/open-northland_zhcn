import { type ContentSet, parseContentSet, type WeaponType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { isRangedWeapon, isSiegeWeapon } from '../../../../src/systems/index.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';

const SWORDSMAN = 6;
const FIGHTER = 31;
const BOW_MUNITION = 1;
const STONE_MUNITION = 2;
const AREA_DAMAGE = 2;

/** The `weapons.ini` shapes: melee rows carry no munition, a bow fires munition without an area damage type,
 *  and a catapult carries both. Rows of one job are split by another so the grouping keeps source order. */
function weaponContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SWORDSMAN, id: 'swordsman' },
      { typeId: FIGHTER, id: 'fighter' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    weapons: [
      { typeId: 5, id: 'sword_short', tribeType: 1, mainType: 3, jobType: SWORDSMAN },
      { typeId: 1, id: 'fist', tribeType: 1, mainType: 1, jobType: FIGHTER },
      { typeId: 8, id: 'mace', tribeType: 2, mainType: 4, jobType: SWORDSMAN },
      {
        typeId: 7,
        id: 'catapult',
        tribeType: 1,
        mainType: 7,
        munitionType: STONE_MUNITION,
        damageType: AREA_DAMAGE,
      },
      { typeId: 6, id: 'bow_short', tribeType: 1, mainType: 6, munitionType: BOW_MUNITION },
    ],
  });
}

function weapon(content: ContentSet, id: string): WeaponType {
  const found = content.weapons.find((w) => w.id === id);
  if (found === undefined) throw new Error(`fixture has no weapon "${id}"`);
  return found;
}

describe('weapon classes', () => {
  it('a munition makes a weapon ranged, and only an area damage type makes it a siege weapon', () => {
    const content = weaponContent();
    const classes = ['fist', 'sword_short', 'bow_short', 'catapult'].map((id) => {
      const w = weapon(content, id);
      return [id, isRangedWeapon(w), isSiegeWeapon(w)];
    });
    expect(classes).toEqual([
      ['fist', false, false],
      ['sword_short', false, false],
      ['bow_short', true, false],
      ['catapult', true, true],
    ]);
  });
});
