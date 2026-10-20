import { systems } from '@open-northland/sim';
import type { Messages } from '../i18n/index.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from './jobs.js';

type GroupCopy = Messages['hud']['groupPanel'];
export type SoldierClass = keyof GroupCopy['soldierClass'];

/** The soldiers' weapon families in the order the HUD lists them: fists, the melee arms, the bow. */
export const SOLDIER_FAMILIES = ['unarmed', 'spear', 'sword', 'bow'] as const;
export type SoldierFamily = (typeof SOLDIER_FAMILIES)[number];

/** Each soldier class by its `jobtypes.ini` id, which the profession list names "Soldier" whatever the
 *  weapon, and the family the class's `jobtypes.ini` name places it in. */
export const SOLDIER_CLASS_OF_JOB: ReadonlyMap<
  number,
  { readonly soldierClass: SoldierClass; readonly family: SoldierFamily }
> = new Map([
  [JOB_SOLDIER_UNARMED, { soldierClass: 'soldier_unarmed', family: 'unarmed' }],
  [JOB_SOLDIER_SPEAR_WOODEN, { soldierClass: 'soldier_spear_wooden', family: 'spear' }],
  [JOB_SOLDIER_SPEAR, { soldierClass: 'soldier_spear_iron', family: 'spear' }],
  [JOB_SOLDIER_SWORD, { soldierClass: 'soldier_sword_short', family: 'sword' }],
  [JOB_SOLDIER_BROADSWORD, { soldierClass: 'soldier_sword_long', family: 'sword' }],
  [JOB_ARCHER, { soldierClass: 'soldier_bow_short', family: 'bow' }],
  [JOB_ARCHER_LONG, { soldierClass: 'soldier_bow_long', family: 'bow' }],
]);

/** The soldiers' extracted weapon families (`weapons.ini` main type), independent of their tier. */
export const SOLDIER_FAMILY_OF_MAIN_TYPE: ReadonlyMap<number, SoldierFamily> = new Map([
  [systems.WEAPON_MAIN_TYPE.UNARMED, 'unarmed'],
  [systems.WEAPON_MAIN_TYPE.SPEAR, 'spear'],
  [systems.WEAPON_MAIN_TYPE.SWORD, 'sword'],
  [systems.WEAPON_MAIN_TYPE.BOW, 'bow'],
]);

/** What a soldier wears, as the subjects window filters it: light (`armortypes.ini` main type, wool and
 *  leather), none, or heavy (chain and plate). Listed in the window's order. */
export const SOLDIER_ARMORS = ['light', 'none', 'heavy'] as const;
export type SoldierArmor = (typeof SOLDIER_ARMORS)[number];

export const SOLDIER_ARMOR_OF_MAIN_TYPE: ReadonlyMap<number, SoldierArmor> = new Map([
  [systems.ARMOR_MAIN_TYPE.LIGHT, 'light'],
  [systems.ARMOR_MAIN_TYPE.HEAVY, 'heavy'],
]);
