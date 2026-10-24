import type { ArmorType, ContentSet } from '@open-northland/data';
import { groupByKey } from './group.js';

/**
 * The extracted `mainType`: `1` for light cloth and leather, `2` for heavy chain and plate. A different
 * axis from the worn `armorClass`, which is the armor's own `typeId` and resolves to the record's material
 * column (`armorMaterialForClass`).
 */
export function armorClassOf(armor: ArmorType): number | undefined {
  return armor.mainType;
}

/** The `armortypes.ini` `maintype` class ids. */
export const ARMOR_MAIN_TYPE = {
  LIGHT: 1,
  HEAVY: 2,
} as const;

/** Armor bucketed by {@link armorClassOf}, in {@link groupByKey} order. */
export function armorByClass(content: ContentSet): Map<number, ArmorType[]> {
  return groupByKey(content.armor, armorClassOf);
}

/**
 * The extracted `materialType`: `1` cloth, `2` leather, `3` chain, `4` plate. Finer than
 * {@link armorClassOf}, which collapses the four base records into two classes.
 */
export function armorMaterialOf(armor: ArmorType): number | undefined {
  return armor.materialType;
}
