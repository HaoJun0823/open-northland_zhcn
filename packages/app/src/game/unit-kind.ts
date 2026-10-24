import type { WeaponType } from '@open-northland/data';
import { type SnapshotEntity, settlerJobType, settlerTribeOf } from './snapshot/index.js';

/** UI grouping uses the extracted weapon family, so short and long bows share a selection.
 * The job is authoritative while a weapon is being changed; weapon ids are scoped by tribe. */
export function soldierWeaponFamily(
  weapons: readonly WeaponType[],
  entity: SnapshotEntity,
): number | undefined {
  const job = settlerJobType(entity);
  const tribe = settlerTribeOf(entity);
  if (job === undefined || tribe === undefined) return undefined;
  return weapons.find((weapon) => weapon.jobType === job && weapon.tribeType === tribe)?.mainType;
}
