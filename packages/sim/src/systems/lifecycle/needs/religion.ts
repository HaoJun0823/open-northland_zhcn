import { needsEnabled, Settler, SettlerNeeds } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { ContentContext } from '../../context.js';
import { atomicSpendsReligion } from '../../readviews/religion.js';
import { carriesNeeds } from './drain-class.js';

/** Deliberate rule: an empty religion reserve blocks further spending, while a paid action may finish.
 * Frozen needs and actors without needs cannot become stuck behind an unchanging bar. */
export function religionAllowsAtomic(
  world: World,
  ctx: ContentContext,
  entity: Entity,
  atomicId: number | undefined,
  paidThrough = 0,
): boolean {
  if (atomicId === undefined || !needsEnabled(world) || !carriesNeeds(world, ctx.content, entity))
    return true;
  if ((world.tryGet(entity, SettlerNeeds)?.piety ?? 0) < ONE) return true;
  return !atomicSpendsReligion(ctx.content, world.get(entity, Settler), atomicId, paidThrough);
}
