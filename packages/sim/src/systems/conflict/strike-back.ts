import {
  AttackOrder,
  CurrentAtomic,
  Fleeing,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  Person,
  PlayerOrder,
  Settler,
  Sheltering,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { attackUnit } from '../orders/combat.js';
import { isAnimalTribe, isFighterJob, seatStrikesBackUnarmed } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { isValidTarget } from './targeting.js';
import { attackerWeapon } from './weapons.js';

// A computer seat's civilians strike back at an unarmed raider instead of running from its blow. A
// deviation of the computer player's own; the original's civilians always run.

/** How far (map points) from where a civilian striking back stood its target may go before the civilian
 *  lets it go and returns to its work. Approximation: a short reach, so no one chases a raider off. */
export const STRIKE_BACK_LEASH_NODES = 6;

/** How many civilians at most strike back at one raider: the struck one and one helper. Approximation. */
export const STRIKE_BACK_PARTY = 2;

/** Whether `attacker` strikes unarmed: a person who is neither a soldier nor a hero. A tower, a vehicle and
 *  an animal are no person. */
function strikesUnarmed(world: World, ctx: SystemContext, attacker: Entity): boolean {
  const settler = world.tryGet(attacker, Settler);
  if (settler === undefined || !world.has(attacker, Person)) return false;
  return !isFighterJob(ctx.content, settler.jobType) && !isAnimalTribe(ctx.content, settler.tribe);
}

/** Whether civilian `e` is free to strike back at `attacker`: armed (fists count), in the open and awake
 *  unless it is the struck one, and under no order, run or shelter of its own. */
function mayStrikeBack(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: Entity,
  struck: boolean,
): boolean {
  const settler = world.get(e, Settler);
  if (isFighterJob(ctx.content, settler.jobType)) return false;
  if (world.has(e, PlayerOrder) || world.has(e, AttackOrder) || world.has(e, Fleeing)) return false;
  if (world.has(e, Sheltering) || hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return false;
  if (!struck && world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep') return false;
  const weapon = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return weapon !== null && isValidTarget(world, ctx, e, settler, attacker);
}

/** Whether `e` already strikes back at `attacker`. */
function strikesBackAt(world: World, e: Entity, attacker: Entity): boolean {
  const order = world.tryGet(e, AttackOrder);
  return order?.leash !== undefined && order.target === attacker;
}

/**
 * Answer a blow on a computer seat's civilian from an unarmed `attacker`: the struck one and the nearest
 * free civilians of `people` (the struck side's people in the open near the blow, ascending distance) take
 * it on, up to {@link STRIKE_BACK_PARTY} counting those already on it, each on a leash of where it stood.
 * Answers whether the seat strikes back, so the rest of its people keep to their work; false leaves the
 * blow to the ordinary run.
 */
export function strikeBack(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  victim: Entity,
  attacker: Entity,
  people: readonly { readonly entity: Entity }[],
): boolean {
  const owner = world.tryGet(victim, Owner);
  if (owner === undefined || !seatStrikesBackUnarmed(world, owner.player)) return false;
  if (isFighterJob(ctx.content, world.get(victim, Settler).jobType)) return false;
  if (!strikesUnarmed(world, ctx, attacker)) return false;
  const origin = { player: owner.player, source: 'military' } as const;
  let party = 0;
  for (const { entity } of people) if (strikesBackAt(world, entity, attacker)) party++;
  const join = (e: Entity): void => {
    if (party >= STRIKE_BACK_PARTY || !mayStrikeBack(world, ctx, e, attacker, e === victim)) return;
    const leash = entityNode(world, terrain, e);
    attackUnit(world, ctx, { kind: 'attackUnit', entity: e, target: attacker }, origin);
    if (world.tryGet(e, AttackOrder)?.target !== attacker) return;
    world.mut(e, AttackOrder).leash = leash;
    party++;
  };
  join(victim);
  for (const { entity } of people) if (entity !== victim) join(entity);
  return party > 0;
}

/** Whether a civilian striking back from `leash` lets its `target` go: the target stands past
 *  {@link STRIKE_BACK_LEASH_NODES} of where the civilian stood. */
export function strayedPastLeash(
  world: World,
  terrain: TerrainGraph,
  leash: NodeId,
  target: Entity,
): boolean {
  return hexNodeDistance(terrain, leash, entityNode(world, terrain, target)) > STRIKE_BACK_LEASH_NODES;
}
