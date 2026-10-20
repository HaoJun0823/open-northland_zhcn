import { type ContentSet, hasHumanForm, unitVariantFor } from '@open-northland/data';
import { removeCurrentAtomic, Settler, setSettlerForm, setSettlerTribe } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { resizeUnitHealth, unitHitpoints } from './unit-health.js';

/**
 * The native form is what the map places and a script spawns: the map's author meant the creature,
 * unless the map's script says its author knew no creature (`MissionScript.authoredForm`, read by the
 * spawn handler). The human form is what training gives, by a human or a computer player alike: a trade
 * taken up at a school, by a profession order or by a weapon (`economy/jobs/trade-change.ts`), and the
 * people chosen for a seat (below). The form stays with the unit through every change of owner, so a
 * script's gift keeps the shape the script gave it. Named addition: the original has one form per class.
 */
/** A settler moved to another people by the seat's people choice: the choice turns the map's soldiers
 *  into soldiers of the chosen people, never into its creatures, so the unit takes the human form where
 *  the new class has one. The health fraction is kept; a change of variant drops the running action,
 *  since its pending strike cannot survive it. */
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
