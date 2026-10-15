import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { ATOMIC_EVENT_CHANNEL, atomicAnimationByName, atomicClipName, eventTick } from './animations.js';

/** Whether a frame of this action not fired in its first `paidThrough` ticks spends religion. Positive
 *  prayer events never block work. */
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
        eventTick(event.at) > paidThrough &&
        event.at < clip.length,
    ) ?? false
  );
}
