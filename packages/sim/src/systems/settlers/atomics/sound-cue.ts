import type { AtomicAnimation } from '@open-northland/data';
import { isWildlife, Settler } from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  atomicAnimationByName,
  atomicClip,
  boundAnimalAtomicAnimation,
  clipEventFactsOf,
} from '../../readviews/animations.js';

/** The running atomic a cue lookup reads - its join key, its length, and the effect that tells a real
 *  swing from a craft clip. */
export interface SoundingAtomic {
  readonly atomicId: number;
  readonly duration: number;
  readonly effect?: { readonly kind: AtomicEffect['kind'] };
}

/**
 * The clip whose sounds `settler` plays for this atomic, or `undefined` when nothing placeable resolves.
 *
 * Wildlife resolves its own tribe's binding only: the civilist fallback belongs to the human bodies, and a
 * bear must not punch like a civilist. The cue frames index the clip's own clock, so an atomic running
 * shorter than the clip is playing something else - a settler asleep in the `_home` twin of its bound
 * sleep clip - and can place none of them.
 */
function soundingClip(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): AtomicAnimation | undefined {
  // A craft clip is stretched over its workplace's batch, so its authored cue frames do not line up with
  // the batch clock below and a workshop stays silent rather than sounding early.
  if (atomic.effect?.kind === 'produce') return undefined;
  const s = world.tryGet(settler, Settler);
  if (s === undefined) return undefined;
  let anim: AtomicAnimation | undefined;
  if (isWildlife(world, settler)) {
    const name = boundAnimalAtomicAnimation(ctx.content, s, atomic.atomicId);
    anim = name === undefined ? undefined : atomicAnimationByName(ctx.content, name);
  } else {
    anim = atomicClip(ctx.content, s, atomic.atomicId);
  }
  return anim === undefined || atomic.duration < anim.length ? undefined : anim;
}

/** Whether this atomic's clip sounds itself, so no engine-chosen sound is wanted for it. */
export function atomicClipSounds(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): boolean {
  const anim = soundingClip(world, ctx, settler, atomic);
  return anim !== undefined && clipEventFactsOf(anim).soundCues.length > 0;
}

/**
 * Emit the sound cues a settler's running atomic authors on this tick: every `event <at> 34 <id>` row of
 * its clip landing on `elapsed` (`eventTick`), carrying `<id>` as the sound bank's `logicSoundType`.
 * A clip authoring no such row is silent.
 */
export function emitAtomicSoundCues(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
  elapsed: number,
): void {
  const anim = soundingClip(world, ctx, settler, atomic);
  if (anim === undefined) return;
  for (const cue of clipEventFactsOf(anim).soundCues) {
    if (cue.tick === elapsed)
      ctx.events.emit({ kind: 'atomicSound', entity: settler, soundType: cue.soundType });
  }
}
