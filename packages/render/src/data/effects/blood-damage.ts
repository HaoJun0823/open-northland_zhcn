import type { SimEvent } from '@open-northland/sim';

export type BloodHit = Extract<SimEvent, { kind: 'combatHit' | 'projectileHit' }>;

export const isBloodHit = (event: SimEvent): event is BloodHit =>
  (event.kind === 'combatHit' || event.kind === 'projectileHit') &&
  event.structure !== true &&
  event.damage > 0 &&
  event.targetMaxHealth > 0;

/** Authored visual wound: the reference pool is capped at this many HP so very durable bodies still show
 * hits. Actual post-protection damage stays linear; a one-HP finishing scratch remains small. */
const BLOOD_REFERENCE_MAX_HEALTH = 5000;

/** The share of a body's reference pool one hit takes, 0..1. */
export function bloodLoss(hit: BloodHit): number {
  return Math.max(0, Math.min(1, hit.damage / Math.min(hit.targetMaxHealth, BLOOD_REFERENCE_MAX_HEALTH)));
}
