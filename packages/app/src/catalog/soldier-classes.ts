import type { Messages } from '../i18n/index.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_AXE_BIG,
  JOB_SOLDIER_AXE_SMALL,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SABER_LONG,
  JOB_SOLDIER_SABER_SHORT,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from './jobs.js';

type GroupCopy = Messages['hud']['groupPanel'];
export type SoldierClass = keyof GroupCopy['soldierClass'];
export type SoldierFamily = keyof GroupCopy['soldierFamilies'];

/** The weapon families in the order the HUD lists them: fists, then the melee arms, then the bow. */
export const SOLDIER_FAMILIES = [
  'unarmed',
  'spear',
  'sword',
  'saber',
  'axe',
  'bow',
] as const satisfies readonly SoldierFamily[];

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
  [JOB_SOLDIER_SABER_SHORT, { soldierClass: 'soldier_saber_short', family: 'saber' }],
  [JOB_SOLDIER_SABER_LONG, { soldierClass: 'soldier_saber_long', family: 'saber' }],
  [JOB_SOLDIER_AXE_SMALL, { soldierClass: 'soldier_axe_small', family: 'axe' }],
  [JOB_SOLDIER_AXE_BIG, { soldierClass: 'soldier_axe_big', family: 'axe' }],
  [JOB_ARCHER, { soldierClass: 'soldier_bow_short', family: 'bow' }],
  [JOB_ARCHER_LONG, { soldierClass: 'soldier_bow_long', family: 'bow' }],
]);

/** The extracted weapon families (`weapons.ini` main type), independent of their equipment tier. */
export const SOLDIER_FAMILY_OF_MAIN_TYPE: ReadonlyMap<number, SoldierFamily> = new Map([
  [1, 'unarmed'],
  [2, 'spear'],
  [3, 'sword'],
  [4, 'saber'],
  [5, 'axe'],
  [6, 'bow'],
]);
