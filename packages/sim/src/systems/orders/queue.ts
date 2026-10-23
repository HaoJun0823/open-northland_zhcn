import type { AiOrderOrigin } from '../../components/ai-order.js';
import {
  AttackOrder,
  ClaimAnimalOrder,
  CurrentAtomic,
  DeferredOrder,
  EquipOrder,
  ErectSignpostOrder,
  ExploreOrder,
  hasMissionBehaviour,
  MealBreak,
  MISSION_BEHAVIOUR,
  NeedOrder,
  OpenChestOrder,
  OrderQueue,
  PlayerOrder,
  QUEUEABLE_ORDER_KINDS,
  type QueueableOrderCommand,
  Rider,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import type { QueuedUnitOrder } from '../../components/settler.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { releaseHaulingCart, releasesHaulingCart } from '../vehicles/hauling-cart.js';
import { orderOpenChest } from './chests.js';
import { equipGood } from './equipment.js';
import { dropOrderQueue, isOrderableSettler } from './guards.js';
import { orderClaimAnimal } from './livestock.js';
import { breaksForMeal, startMealBreak } from './meal-break.js';
import { attackMoveUnit, moveUnit } from './movement.js';
import { orderNeed } from './needs.js';
import { pushQueuedOrder, queueChangedHands, queuedOrderAuthorized, startQueuedOrders } from './queued.js';
import { placeSignpost } from './signposts.js';

const QUEUEABLE_KINDS: ReadonlySet<Command['kind']> = new Set(QUEUEABLE_ORDER_KINDS);

function isQueueableOrder(command: Command): command is QueueableOrderCommand {
  return QUEUEABLE_KINDS.has(command.kind);
}

/** Whether `command` asks to wait behind the settler's current order. */
export function isQueuedOrder(command: Command): command is QueueableOrderCommand {
  return isQueueableOrder(command) && command.queued === true;
}

/**
 * Whether `e` is carrying out an order the player gave that ends on its own: a walk or march, an errand
 * with its closing swing, a strike, a drill or course, a sweep, a need order being answered, or an order
 * parked behind an atomic; or hunger has taken it off its orders for a meal. The settler's other doings
 * are not waited for: a fight it picked, a breach of its own, or an assistant's errand. A need order
 * nothing answers is dropped by the drive ladder while orders wait (`dropUnservedNeedOrder`).
 */
function holdsCurrentOrder(world: World, e: Entity): boolean {
  if (
    world.has(e, PlayerOrder) ||
    world.has(e, ErectSignpostOrder) ||
    world.has(e, OpenChestOrder) ||
    world.has(e, ClaimAnimalOrder) ||
    world.has(e, TrainingOrder) ||
    world.has(e, ExploreOrder) ||
    world.has(e, DeferredOrder) ||
    world.has(e, MealBreak) ||
    world.has(e, NeedOrder)
  ) {
    return true;
  }
  if (world.tryGet(e, EquipOrder)?.issuer === 'player') return true;
  const attack = world.tryGet(e, AttackOrder);
  if (attack !== undefined && attack.breach?.enemy === undefined) return true;
  const effect = world.tryGet(e, CurrentAtomic)?.effect.kind;
  return effect === 'erectSignpost' || effect === 'openChest';
}

/**
 * Line a queued order up behind the settler's current one. True when it was queued (or dropped past
 * `ORDER_QUEUE_LIMIT`); false when the settler has nothing to wait for, or rides a vehicle whose walk
 * orders drive or leave it, so the command applies at once like an unqueued one.
 */
export function queueBehindCurrentOrder(
  world: World,
  command: QueueableOrderCommand,
  origin?: AiOrderOrigin,
): boolean {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || world.has(e, Rider)) return false;
  return pushQueuedOrder(world, OrderQueue, e, unqueued(command, origin), () => holdsCurrentOrder(world, e));
}

/** A fresh copy without the queue flag: the stored command is component state, the caller's sits in the
 *  replay log. */
function unqueued(command: QueueableOrderCommand, origin?: AiOrderOrigin): QueuedUnitOrder {
  const { queued: _queued, ...order } = command;
  return { ...order, ...(origin === undefined ? {} : { aiOrder: { ...origin } }) };
}

/**
 * Start each settler's next queued order once its current one is done. Scheduled after the order systems
 * that retire an arrived walk or turn it into its errand, and before the planner, so an arrival walks on
 * the same tick instead of being re-tasked. The needs drive gets no tick between two legs, except a meal
 * break that holds the queue until the settler has eaten (`meal-break.ts`). An order refused at its start
 * is skipped for the next one. A settler aboard a vehicle, one a script took out of the player's hands, or
 * one handed to another player drops its queue.
 */
export const orderQueueSystem: System = (world, ctx) => {
  // Collected first: putting the rest back re-adds the component under the query.
  for (const e of [...world.query(Settler, OrderQueue)]) {
    if (
      world.has(e, Rider) ||
      hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE) ||
      queueChangedHands(world, OrderQueue, e)
    ) {
      dropOrderQueue(world, e);
      continue;
    }
    if (holdsCurrentOrder(world, e)) continue;
    if (breaksForMeal(world, ctx, e)) {
      startMealBreak(world, e);
      continue;
    }
    startQueuedOrders(
      world,
      OrderQueue,
      e,
      () => holdsCurrentOrder(world, e),
      (order) => startQueuedOrder(world, ctx, order),
    );
  }
};

/** A started order wakes an idle settler the way an order applied by the command pass does, so a need
 *  order is planned this tick rather than on the settler's next re-plan beat. */
function startQueuedOrder(world: World, ctx: SystemContext, queued: QueuedUnitOrder): void {
  const { aiOrder: origin, ...command } = queued;
  if (!queuedOrderAuthorized(world, ctx, command, origin)) return;
  wakeIdle(world, command.entity);
  if (releasesHaulingCart(command)) releaseHaulingCart(world, ctx, command.entity);
  switch (command.kind) {
    case 'moveUnit':
      moveUnit(world, ctx, command, origin);
      return;
    case 'attackMoveUnit':
      attackMoveUnit(world, ctx, command, origin);
      return;
    case 'placeSignpost':
      placeSignpost(world, ctx, command, origin);
      return;
    case 'openChest':
      orderOpenChest(world, ctx, command);
      return;
    case 'claimAnimal':
      orderClaimAnimal(world, ctx, command);
      return;
    case 'equipGood':
      equipGood(world, ctx, command);
      return;
    case 'orderNeed':
      orderNeed(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
