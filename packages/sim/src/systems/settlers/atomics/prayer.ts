import { jobCanPray } from '@open-northland/data';
import { DeferredOrder, needsEnabled, Settler, SettlerNeeds } from '../../../components/index.js';
import { ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { carriesNeeds, NEED_DRIVE_THRESHOLD, needLevel } from '../../lifecycle/needs/index.js';
import { ATOMIC_EVENT_CHANNEL, atomicClipName, atomicEventChannelDelta } from '../../readviews/animations.js';

/** Deliberate rule: a prayer visit fills the reserve, repeating its clip without a trip through work.
 * Higher-priority needs and orders can end the visit; a clip that cannot help must not hold it forever. */
export function continuesPrayer(world: World, ctx: SystemContext, entity: Entity, atomicId: number): boolean {
  if (!needsEnabled(world) || !carriesNeeds(world, ctx.content, entity) || world.has(entity, DeferredOrder))
    return false;
  const needs = world.get(entity, SettlerNeeds);
  if (
    needs.piety <= ZERO ||
    needLevel(needs, 'hunger', ctx.tick) >= NEED_DRIVE_THRESHOLD ||
    needLevel(needs, 'fatigue', ctx.tick) >= NEED_DRIVE_THRESHOLD
  )
    return false;
  const settler = world.get(entity, Settler);
  if (!jobCanPray(ctx.content.jobs, settler.jobType)) return false;
  const clip = atomicClipName(ctx.content, settler, atomicId);
  return clip !== undefined && atomicEventChannelDelta(ctx.content, clip, ATOMIC_EVENT_CHANNEL.PIETY) > 0;
}
