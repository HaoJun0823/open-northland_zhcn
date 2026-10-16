import { STORAGE_MINIMUM_MAX, StorageMinimums, storageMinimumsEntity } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** Set one good's minimum in `player`'s storehouses - see the command doc. The carrier is created with
 *  the first minimum and destroyed when the last returns to zero. */
export function setStorageMinimum(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStorageMinimum' }>,
): void {
  if (!contentIndex(ctx.content).goods.has(command.goodType)) return;
  // A typed producer skips the payload parser, and a non-finite amount would escape the clamp.
  if (!Number.isFinite(command.amount)) return;
  const amount = Math.min(STORAGE_MINIMUM_MAX, Math.max(0, Math.trunc(command.amount)));
  const carrier = storageMinimumsEntity(world, command.player);
  const current =
    carrier === null ? 0 : (world.get(carrier, StorageMinimums).minimums.get(command.goodType) ?? 0);
  if (amount === current) return;
  if (carrier === null) {
    world.add(world.create(), StorageMinimums, {
      player: command.player,
      minimums: new Map([[command.goodType, amount]]),
    });
    return;
  }
  const minimums = world.mut(carrier, StorageMinimums).minimums;
  if (amount > 0) minimums.set(command.goodType, amount);
  else minimums.delete(command.goodType);
  if (minimums.size === 0) world.destroy(carrier);
}
