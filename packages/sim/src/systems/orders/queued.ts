import type { AiOrderOrigin } from '../../components/ai-order.js';
import { ORDER_QUEUE_LIMIT, ownerOf } from '../../components/index.js';
import type { AiDecisionSource, PlayerCommand } from '../../core/commands/index.js';
import { aiCommand, playerCommand } from '../../core/commands/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { authorizedCommand } from '../command/authority.js';
import type { SystemContext } from '../context.js';

// The mechanics a settler's `OrderQueue` and a vehicle's `VehicleOrderQueue` share. Each queue keeps its own
// schedule slot, its own reading of what its unit is busy with, and its own start switch.

/** A stored order: the command without its queue flag, and the AI controller that queued it, if one did. */
export interface QueuedOrder {
  readonly aiOrder?: AiOrderOrigin;
}

/** A queue store's value: `owner` is the unit's player when the first order was queued. */
export interface QueueState<T extends QueuedOrder> {
  orders: T[];
  owner: number;
}

/**
 * Line `order` up on `e`'s queue. True when it was queued (or dropped past {@link ORDER_QUEUE_LIMIT});
 * false when `e` has no queue yet and `holdsOrder` says it has nothing to wait for, so the command applies
 * at once like an unqueued one.
 */
export function pushQueuedOrder<T extends QueuedOrder>(
  world: World,
  store: Component<QueueState<T>>,
  e: Entity,
  order: T,
  holdsOrder: (next: T) => boolean,
): boolean {
  const queue = world.tryMut(e, store);
  if (queue === undefined) {
    const owner = ownerOf(world, e);
    if (owner === undefined || !holdsOrder(order)) return false;
    world.add(e, store, { orders: [order], owner });
  } else if (queue.orders.length < ORDER_QUEUE_LIMIT) {
    queue.orders.push(order);
  }
  return true;
}

/** Whether `e` was handed to another player since its queue began: the orders were its old owner's. */
export function queueChangedHands<T extends QueuedOrder>(
  world: World,
  store: Component<QueueState<T>>,
  e: Entity,
): boolean {
  return ownerOf(world, e) !== world.get(e, store).owner;
}

/**
 * Start `e`'s queued orders oldest first until the unit is held for the next one (`holdsOrder`) or none is
 * left; the rest wait again. The queue is taken off first, since a started order drops the queue as any
 * order does.
 */
export function startQueuedOrders<T extends QueuedOrder>(
  world: World,
  store: Component<QueueState<T>>,
  e: Entity,
  holdsOrder: (next: T) => boolean,
  start: (order: T, owner: number) => void,
): void {
  const { orders, owner } = world.mut(e, store);
  const pending = [...orders];
  world.remove(e, store);
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    start(next, owner);
    const following = pending[0];
    if (following !== undefined && holdsOrder(following)) break;
  }
  if (pending.length > 0) world.add(e, store, { orders: pending, owner });
}

/** Whether whoever queued `command` may still issue it as it starts: the AI controller that queued it, or
 *  the queue's `owner`, from whose hands a script may since have taken the target or the vehicle. */
export function queuedOrderAuthorized(
  world: World,
  ctx: SystemContext,
  command: PlayerCommand,
  origin: AiOrderOrigin | undefined,
  owner: number,
): boolean {
  const envelope =
    origin === undefined ? playerCommand(owner, command) : aiCommand(origin.player, command, origin.source);
  return authorizedCommand(world, envelope, ctx.terrain) !== undefined;
}

/** Drop the orders `player`'s stopped controllers queued in `store`. */
export function withdrawQueuedAiOrders<T extends QueuedOrder>(
  world: World,
  store: Component<QueueState<T>>,
  player: number,
  stopped: (source: AiDecisionSource) => boolean,
): void {
  for (const entity of [...world.query(store)]) {
    const withdrawn = (order: QueuedOrder): boolean =>
      order.aiOrder?.player === player && stopped(order.aiOrder.source);
    if (!world.get(entity, store).orders.some(withdrawn)) continue;
    const queue = world.mut(entity, store);
    queue.orders = queue.orders.filter((order) => !withdrawn(order));
    if (queue.orders.length === 0) world.remove(entity, store);
  }
}
