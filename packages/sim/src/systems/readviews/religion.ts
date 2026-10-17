import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { atomicClip, clipEventFactsOf, NO_PIETY_SPEND_TICK } from './animations.js';

/** Whether a frame of this action not fired in its first `paidThrough` ticks spends religion. Positive
 *  prayer events never block work. */
export function atomicSpendsReligion(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
  paidThrough = 0,
): boolean {
  return clipSpendsReligion(atomicClip(content, settler, atomicId), paidThrough);
}

/** {@link atomicSpendsReligion} for an already resolved clip. */
export function clipSpendsReligion(clip: AtomicAnimation | undefined, paidThrough: number): boolean {
  if (clip === undefined) return false;
  const lastSpend = clipEventFactsOf(clip).lastPietySpendTick;
  return lastSpend !== NO_PIETY_SPEND_TICK && lastSpend > paidThrough;
}
