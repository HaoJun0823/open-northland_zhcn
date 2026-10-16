import { needsEnabled, Settler, SettlerNeeds } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { ContentContext } from '../../context.js';
import { atomicSpendsReligion } from '../../readviews/religion.js';
import { settlerCarriesNeeds } from './drain-class.js';

/** Deliberate rule: an empty religion reserve blocks further spending, while a paid action may finish.
 * Frozen needs and actors without needs cannot become stuck behind an unchanging bar. A frame spends
 * religion when it carries a negative piety event and fires after the first `paidThrough` ticks. */
export function religionAllowsAtomic(
  world: World,
  ctx: ContentContext,
  entity: Entity,
  atomicId: number | undefined,
  paidThrough = 0,
): boolean {
  if (atomicId === undefined || !needsEnabled(world)) return true;
  if ((world.tryGet(entity, SettlerNeeds)?.piety ?? 0) < ONE) return true;
  const settler = world.tryGet(entity, Settler);
  if (settler === undefined) return true;
  if (!atomicSpendsReligion(ctx.content, settler, atomicId, paidThrough)) return true;
  return !settlerCarriesNeeds(world, ctx.content, entity, settler);
}
