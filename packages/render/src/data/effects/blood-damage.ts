import type { SimEvent } from '@open-northland/sim';

export type BloodHit = Extract<SimEvent, { kind: 'combatHit' | 'projectileHit' }>;

export const isBloodHit = (event: SimEvent): event is BloodHit =>
  (event.kind === 'combatHit' || event.kind === 'projectileHit') &&
  event.structure !== true &&
  event.damage > 0 &&
  event.targetMaxHealth > 0;

/** Authored visual wound: cap the reference pool at 5000 HP so very durable bodies still show hits.
 * Actual post-protection damage stays linear; a one-HP finishing scratch remains small. */
export function bloodLoss(hit: BloodHit): number {
  return Math.max(0, Math.min(1, hit.damage / Math.min(hit.targetMaxHealth, 5000)));
}
