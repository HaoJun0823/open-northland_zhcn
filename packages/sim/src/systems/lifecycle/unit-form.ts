import { type ContentSet, hasHumanForm, unitVariantFor } from '@open-northland/data';
import { removeCurrentAtomic, Settler, setSettlerForm, setSettlerTribe } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { resizeUnitHealth, unitHitpoints } from './unit-health.js';

/** A seat's people choice gives soldiers the chosen people's human form, keeping their health fraction.
 *  A changed variant drops the old action and its pending strike.
 *  Named addition: the original has one form per class. */
export function changeUnitTribe(world: World, content: ContentSet, e: Entity, tribe: number): void {
  const identity = world.get(e, Settler);
  const previousHitpoints = unitHitpoints(content, identity);
  const previousVariant = unitVariantFor(content, identity);
  setSettlerTribe(world, e, tribe);
  setSettlerForm(world, e, hasHumanForm(content, tribe, identity.jobType));
  const next = world.get(e, Settler);
  resizeUnitHealth(world, e, previousHitpoints, unitHitpoints(content, next));
  if (previousVariant !== unitVariantFor(content, next)) removeCurrentAtomic(world, e);
}
