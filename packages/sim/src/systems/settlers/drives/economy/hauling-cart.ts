import { HaulingCart, type HaulingLift, PathRequest } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { boardingNode } from '../../../vehicles/crew.js';
import {
  cartLiftContinues,
  endCartLift,
  haulingCartHolds,
  haulingCartRoom,
  releaseHaulingCart,
  takeHaulingCart,
} from '../../../vehicles/hauling-cart.js';
import { atOrWalk, startCartLoad, startCartUnload } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, unclaimedStockOf } from '../../targets/index.js';

/**
 * HAULING CART - a posted carrier handed a cart, or one back from a break that parked it, walks to its
 * door and takes it there; one in a lift beside the standing cart plays the next clip of it, a unit each,
 * and takes the cart up again when the lift is done; one whose hold no longer stands (the post or the
 * trade gone, the cart gone or another player's) sets the cart down and falls through. A door it cannot
 * reach, or one on another continent, gives the cart up where it stands. True while the carrier walks to
 * the cart, lifts beside it or takes it this tick; a carrier with a load in hand delivers first, so the
 * rung only reconciles for it.
 */
export function planHaulingCart(plan: PlannerContext, loaded: boolean): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined) return false;
  if (!haulingCartHolds(world, ctx.content, e)) {
    releaseHaulingCart(world, ctx, e);
    return false;
  }
  if (held.lift !== null) {
    if (continueLift(plan, held.lift)) return true;
    endCartLift(world, e);
  }
  if (held.taken || loaded) return false;
  const door = boardingNode(world, ctx, terrain, held.vehicle);
  const request = world.tryGet(e, PathRequest);
  if (
    door === null ||
    terrain.componentOf(door) !== terrain.componentOf(here) ||
    (request?.failed === true && request.goal === door)
  ) {
    releaseHaulingCart(world, ctx, e);
    return false;
  }
  atOrWalk(world, e, here, door, () => takeHaulingCart(world, ctx.content, e));
  return true;
}

/** The next clip of the lift, from the cell it works at; false once there is nothing left to move. A
 *  load claims the units it still means to lift again before each clip, since the clip's pick-up ends
 *  the claim, so another carrier planned meanwhile picks another heap. */
function continueLift(plan: PlannerContext, lift: HaulingLift): boolean {
  const { world, ctx, terrain, entity: e, here, supply } = plan;
  const offers = (from: Entity, goodType: number): number =>
    unclaimedStockOf(world, ctx, supply, from, goodType);
  if (!cartLiftContinues(world, ctx, e, lift, offers)) return false;
  if (lift.kind === 'load') {
    const amount = Math.min(
      lift.units,
      haulingCartRoom(world, ctx.content, e),
      offers(lift.from, lift.goodType),
    );
    supply.stampPickupClaim(e, { source: lift.from, goodType: lift.goodType, amount });
  }
  const at = lift.kind === 'load' ? lift.from : lift.store;
  const cell = interactionCell(world, ctx, terrain, at, here);
  atOrWalk(world, e, here, cell, () => {
    if (lift.kind === 'load') startCartLoad(world, ctx, e, plan, lift.from, lift.goodType, lift.units);
    else startCartUnload(world, ctx, e, plan, lift.store);
  });
  return true;
}
