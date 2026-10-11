import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { ATOMIC_EVENT_CHANNEL, atomicAnimationByName, atomicClipName } from './animations.js';

/** Whether an unpaid frame of this action spends religion. Positive prayer events never block work. */
export function atomicSpendsReligion(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
  paidThrough = 0,
): boolean {
  const name = atomicClipName(content, settler, atomicId);
  const clip = name === undefined ? undefined : atomicAnimationByName(content, name);
  return (
    clip?.events.some(
      (event) =>
        event.type === ATOMIC_EVENT_CHANNEL.PIETY &&
        (event.value ?? 0) < 0 &&
        event.at > paidThrough &&
        event.at <= clip.length,
    ) ?? false
  );
}
