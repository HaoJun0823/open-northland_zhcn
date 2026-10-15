import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import type { Rng } from '../../core/rng.js';
import { atomicAnimationByName, boundAnimalAtomicAnimation } from '../readviews/animations.js';

/** Original behavior: an idle animal plays one of its atomics 2..7 at random before it decides again. */
const IDLE_ATOMIC_FIRST = 2;
const IDLE_ATOMIC_COUNT = 6;
/** The atomic an animal grazes with. */
export const EAT_ATOMIC = 9;
/** A clip length for a creature whose content binds none. Approximation: the length most species'
 *  idle clips carry. */
const UNBOUND_CLIP_TICKS = 100;

/** The length in ticks of the clip `settler` plays for `atomicId`. */
export function animalClipTicks(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  const name = boundAnimalAtomicAnimation(content, settler, atomicId);
  const length = name === undefined ? 0 : (atomicAnimationByName(content, name)?.length ?? 0);
  return length > 0 ? length : UNBOUND_CLIP_TICKS;
}

/** The length of a random idle clip, after which the animal decides again. */
export function idleClipTicks(content: ContentSet, rng: Rng, settler: SettlerIdentity): number {
  return animalClipTicks(content, settler, IDLE_ATOMIC_FIRST + rng.int(IDLE_ATOMIC_COUNT));
}
