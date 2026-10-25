import {
  type AiOrderOrigin,
  type AttackLeash,
  AttackOrder,
  CurrentAtomic,
  Fleeing,
  Health,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  Person,
  PlayerOrder,
  Position,
  Resting,
  Rider,
  Settler,
  Sheltering,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, rowReachLeft, rowReachRight } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { ownedFighters } from '../movement/collision/owned-fighters.js';
import { settlersByNode } from '../movement/settler-nodes.js';
import { attackUnit } from '../orders/combat.js';
import { isAnimalTribe, isFighterJob, seatStrikesBackUnarmed } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { isValidTarget } from './targeting.js';
import { standsAtPost, towerPostFor } from './tower-post.js';
import { attackerWeapon } from './weapons.js';

// A computer seat's civilians strike back at an unarmed raider instead of running from its blow, when the
// seat has no soldier to send. A deviation of the computer player's own; the original's civilians always run.

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
 * it on, each on a leash of where it stood. A seat that fields a soldier leaves the answer to its soldiers
 * (the hit alarm and its defence decision), so its civilians run as the original's do. Answers whether the
 * seat strikes back, so the rest of its people keep to their work; false leaves the blow to the ordinary run.
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
  if (seatFieldsSoldier(world, ctx, owner.player)) return false;
  const origin = { player: owner.player, source: 'military' } as const;
  const party = [victim];
  for (const { entity } of people) if (entity !== victim) party.push(entity);
  return (
    strikeParty(world, ctx, attacker, party, victim, origin, (e) => ({
      at: entityNode(world, terrain, e),
      radius: STRIKE_BACK_LEASH_NODES,
    })) > 0
  );
}

/**
 * Send the first free civilians of `people` (nearest first) at `attacker`, up to {@link STRIKE_BACK_PARTY}
 * counting those of them already on it, each on the leash `leashOf` gives it. `struck` is the one the blow
 * fell on, who strikes back even woken from sleep, or null. Answers the party's size.
 */
export function strikeParty(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  people: readonly Entity[],
  struck: Entity | null,
  origin: AiOrderOrigin,
  leashOf: (e: Entity) => AttackLeash,
): number {
  let party = 0;
  for (const e of people) if (strikesBackAt(world, e, attacker)) party++;
  for (const e of people) {
    if (party >= STRIKE_BACK_PARTY) break;
    if (!mayStrikeBack(world, ctx, e, attacker, e === struck)) continue;
    if (leashedAttack(world, ctx, e, attacker, leashOf(e), origin)) party++;
  }
  return party;
}

/** Order `e` at `target` on `leash`; answers whether the order took. */
export function leashedAttack(
  world: World,
  ctx: SystemContext,
  e: Entity,
  target: Entity,
  leash: AttackLeash,
  origin: AiOrderOrigin,
): boolean {
  attackUnit(world, ctx, { kind: 'attackUnit', entity: e, target }, origin);
  if (world.tryGet(e, AttackOrder)?.target !== target) return false;
  world.mut(e, AttackOrder).leash = leash;
  return true;
}

/**
 * Whether `player` fields a soldier it could send: a live fighter on the map, holding no tower post and
 * riding nothing, under the seat's control. One busy fighting elsewhere still counts; he comes free.
 */
export function seatFieldsSoldier(world: World, ctx: SystemContext, player: number): boolean {
  for (const e of ownedFighters(world, ctx.content)) {
    if (world.get(e, Owner).player !== player || !world.has(e, Person) || !world.has(e, Position)) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0 || world.has(e, Rider)) continue;
    const jobType = world.get(e, Settler).jobType;
    if (jobType !== null && towerPostFor(world, ctx, e, jobType) !== null) continue;
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) continue;
    return true;
  }
  return false;
}

/** `player`'s people out in the open within `radius` map points of `at`, ascending (distance, id). */
export function peopleNear(
  world: World,
  terrain: TerrainGraph,
  player: number,
  at: NodeId,
  radius: number,
): Entity[] {
  const centre = { hx: terrain.xOf(at), hy: terrain.yOf(at) };
  const byNode = settlersByNode(world);
  const near: { entity: Entity; distance: number }[] = [];
  const lastRow = Math.min(terrain.height - 1, centre.hy + radius);
  for (let hy = Math.max(0, centre.hy - radius); hy <= lastRow; hy++) {
    const right = Math.min(terrain.width - 1, rowReachRight(centre, hy, radius));
    for (let hx = Math.max(0, rowReachLeft(centre, hy, radius)); hx <= right; hx++) {
      for (const e of byNode.at(hx, hy)) {
        if (world.tryGet(e, Owner)?.player !== player || !world.has(e, Person)) continue;
        if (world.has(e, Resting) && standsAtPost(world, e) === null) continue; // indoors
        near.push({ entity: e, distance: hexDistanceBetween(hx, hy, centre.hx, centre.hy) });
      }
    }
  }
  near.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
  return near.map((n) => n.entity);
}

/** Whether a defender on `leash` lets its `target` go: the target stands past the leash's radius of its
 *  anchor. */
export function strayedPastLeash(
  world: World,
  terrain: TerrainGraph,
  leash: AttackLeash,
  target: Entity,
): boolean {
  return hexNodeDistance(terrain, leash.at, entityNode(world, terrain, target)) > leash.radius;
}
