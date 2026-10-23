import {
  Building,
  Health,
  Person,
  Settler,
  SettlerNeeds,
  Stockpile,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { clearRepairedDamage, markShortPool } from '../economy/repair.js';
import { razeBuilding } from '../lifecycle/cleanup.js';
import { mutNeeds } from '../lifecycle/needs/levels.js';
import { teleportHuman } from '../orders/teleport.js';
import { constructionBillOf } from '../stores/construction.js';

// The `debug*` commands are real commands, logged and replayed like any other, so each is a no-op on a
// target of the wrong kind rather than a throw.

/**
 * Kill a unit or wreck a vehicle by draining its {@link Health} pool to 0, so the CleanupSystem reaps it
 * through the real death or wreck path, or raze a building through the teardown its demolish and a
 * combat kill share. A building is not drained, since a site's pool would skip that teardown.
 */
export function debugKill(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'debugKill' }>,
): void {
  if (world.has(command.target, Building)) {
    razeBuilding(world, ctx, command.target);
    return;
  }
  if (!world.has(command.target, Settler) && !world.has(command.target, Vehicle)) return;
  const health = world.tryMut(command.target, Health);
  if (health !== undefined) health.hitpoints = 0;
}

export function debugSetHealth(world: World, command: Extract<Command, { kind: 'debugSetHealth' }>): void {
  const { target, percent } = command;
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return;
  if (!world.has(target, Building) && !world.has(target, Settler) && !world.has(target, Vehicle)) return;
  const health = world.tryGet(target, Health);
  if (health === undefined || health.max <= 0 || health.hitpoints <= 0) return;
  const building = world.tryGet(target, Building);
  const ceiling =
    building !== undefined && building.built < ONE && !world.has(target, Upgrading)
      ? Math.max(1, Math.trunc((health.max * building.built) / ONE))
      : health.max;
  const hitpoints = Math.max(1, Math.floor((ceiling * percent) / 100));
  if (health.hitpoints !== hitpoints) world.mut(target, Health).hitpoints = hitpoints;
  if (building !== undefined) {
    if (hitpoints < ceiling) markShortPool(world, target);
    else clearRepairedDamage(world, target);
  }
}

/** Set the needs the panel names to whole-percent levels (0 sated … 100 maxed). A non-settler target is a
 *  no-op. */
export function debugSetNeeds(
  world: World,
  drainedThrough: number,
  command: Extract<Command, { kind: 'debugSetNeeds' }>,
): void {
  if (!world.has(command.target, SettlerNeeds)) return;
  const settler = mutNeeds(world, command.target, drainedThrough);
  if (command.hunger !== undefined) settler.hunger = needFixedFromPct(command.hunger);
  if (command.fatigue !== undefined) settler.fatigue = needFixedFromPct(command.fatigue);
  if (command.piety !== undefined) settler.piety = needFixedFromPct(command.piety);
  if (command.enjoyment !== undefined) settler.enjoyment = needFixedFromPct(command.enjoyment);
}

/** A whole-percent need level (`0..100`, clamped) as the `0..ONE` need `Fixed`: a single truncation
 *  (`ONE · pct / 100`), so 0 and 100 land exactly on the endpoints. */
function needFixedFromPct(pct: number): Fixed {
  const clamped = pct < 0 ? 0 : pct > 100 ? 100 : Math.trunc(pct);
  return fx.mulDiv(ONE, fx.fromInt(clamped), fx.fromInt(100));
}

/**
 * Fill declared stock slots, or just the selected good. A construction site's stockpile is its delivered
 * material, so a site gets its construction bill instead: every line, or the selected good's line.
 * Invalid selections and targets are no-ops.
 */
export function debugFillStockpile(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'debugFillStockpile' }>,
): void {
  const building = world.tryGet(command.target, Building);
  if (building === undefined || !world.has(command.target, Stockpile)) return;
  const type = contentIndex(ctx.content).commandBuildings.get(building.buildingType);
  if (type === undefined) return;
  const slots = world.has(command.target, UnderConstruction)
    ? constructionBillOf(world, ctx, command.target).map((line) => ({
        goodType: line.goodType,
        capacity: line.amount,
      }))
    : type.stock;
  if (command.goodType !== undefined && !Number.isSafeInteger(command.goodType)) return;
  const selected =
    command.goodType === undefined ? slots : slots.filter((slot) => slot.goodType === command.goodType);
  if (selected.length === 0) return;
  const stock = world.mut(command.target, Stockpile).amounts;
  for (const slot of selected) stock.set(slot.goodType, slot.capacity);
}

/** Teleport a human onto walkable ground; any other target, or an off-map or unwalkable node, is a
 *  no-op. A mapless sim has no ground to judge, so it refuses too. */
export function debugTeleport(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'debugTeleport' }>,
): void {
  const { target, x, y } = command;
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(target, Person)) return;
  if (!terrain.inBounds(x, y) || !terrain.isWalkable(terrain.nodeAt(x, y))) return;
  teleportHuman(world, ctx, target, { hx: x, hy: y });
}
