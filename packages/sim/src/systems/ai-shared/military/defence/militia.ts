import {
  AttackOrder,
  Building,
  Garrison,
  Health,
  hasMissionBehaviour,
  JobAssignment,
  MISSION_BEHAVIOUR,
  Militia,
  Owner,
  Settler,
  Sheltering,
  TrainingOrder,
  WorkFlag,
} from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { leashedAttack } from '../../../conflict/leash.js';
import { attackerWeapon } from '../../../conflict/weapons.js';
import type { SystemContext } from '../../../context.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { peopleNear } from '../../../movement/settler-nodes.js';
import { atomicBlocksOrder, deferOrderDuringAtomic, mayChangeTrade } from '../../../orders/guards.js';
import { assignWorker, takeUpTrade } from '../../../orders/work/employment.js';
import { canChooseJob, needSubjectOf } from '../../../progression/index.js';
import { hunterJobType, isFighterJob, isHunterJob } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { isCarrierJob } from '../../../stores/workplace.js';
import { ownedSettlers } from '../../seat-roster.js';
import { desperateZones, type SeatThreat, type ZoneThreat } from './danger.js';

// A computer seat whose settlement zone is desperate arms some of its civilians as hunters and sends them at
// the raiders there, then puts them back to work once the zone has been safe a while. An extension of this
// engine: the original never arms its civilians. Every number here is an approximation.

/** The most civilians one desperate zone arms. */
export const MILITIA_PER_ZONE_MAX = 4;
/** The most civilians one seat holds armed at a time. */
export const MILITIA_PER_SEAT_MAX = 8;
/** At most one in this many of the seat's people is armed, so the economy keeps running. */
export const MILITIA_PEOPLE_SHARE = 4;
/** How long (ticks) a militiaman stays armed after his zone was last desperate: the original's defence
 *  hold after the last blow. */
export const MILITIA_HOLD_TICKS = 360;

/** Who is armed first: the idle, then the carriers, then the other workers; nearest first within each. */
const IDLE_RANK = 0;
const CARRIER_RANK = 1;
const WORKER_RANK = 2;

/**
 * One defence decision of a computer seat: keep its militia on the raiders of the zones still desperate in
 * `threat`, send home those whose zone has been safe for {@link MILITIA_HOLD_TICKS}, and arm more civilians
 * near each desperate zone up to the caps. Content without a hunter trade arms nobody.
 *
 * Costs the seat's militiamen, plus a scan of each desperate zone's people.
 */
export function musterMilitia(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  threat: SeatThreat,
): void {
  const desperate = new Map<Entity, ZoneThreat>();
  for (const zone of desperateZones(threat)) desperate.set(zone.anchor, zone);
  const perZone = new Map<Entity, number>();
  let armed = 0;
  for (const e of militiaOf(world, player)) {
    if (!isHunterJob(ctx.content, world.get(e, Settler).jobType)) {
      world.remove(e, Militia); // a script or a drill changed his trade since: no longer the militia's
      continue;
    }
    const member = world.get(e, Militia);
    const zone = desperate.get(member.zone);
    if (zone !== undefined) {
      const releaseTick = ctx.tick + MILITIA_HOLD_TICKS;
      if (member.releaseTick !== releaseTick) world.mut(e, Militia).releaseTick = releaseTick;
      if (!world.has(e, AttackOrder) && !world.has(e, Sheltering)) engage(world, ctx, terrain, e, zone);
    } else if (ctx.tick >= member.releaseTick && standDown(world, ctx, e, member)) {
      continue;
    }
    armed++;
    perZone.set(member.zone, (perZone.get(member.zone) ?? 0) + 1);
  }
  if (desperate.size === 0) return;
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return;
  const seatCap = Math.min(
    MILITIA_PER_SEAT_MAX,
    Math.floor(ownedSettlers(world, player).length / MILITIA_PEOPLE_SHARE),
  );
  for (const zone of desperate.values()) {
    const want = Math.min(MILITIA_PER_ZONE_MAX - (perZone.get(zone.anchor) ?? 0), seatCap - armed);
    if (want <= 0) continue;
    for (const e of recruits(world, ctx, terrain, player, zone, hunterJob, want)) {
      arm(world, ctx, terrain, e, zone, hunterJob);
      armed++;
    }
  }
}

/**
 * Send every militiaman of `player` home at once, as the computer stops running the seat's military and
 * nothing else would. One a clip holds takes up his old trade once it ends, unposted.
 */
export function disbandMilitia(world: World, ctx: SystemContext, player: number): void {
  for (const e of militiaOf(world, player)) {
    const member = world.get(e, Militia);
    const previousJob = member.previousJob;
    if (standDown(world, ctx, e, member)) continue;
    world.remove(e, Militia);
    deferOrderDuringAtomic(world, ctx, e, { kind: 'setJob', entity: e, jobType: previousJob });
  }
}

/** `player`'s militiamen, ascending id. */
function militiaOf(world: World, player: number): Entity[] {
  const members: Entity[] = [];
  for (const e of world.query(Militia)) {
    if (world.tryGet(e, Owner)?.player === player) members.push(e);
  }
  return members.sort((a, b) => a - b);
}

/** Up to `want` of `player`'s people in the open within `zone`'s reach who may take up `hunterJob` and
 *  shoot with it, ranked idle, carrier, worker, then nearest the zone's building. */
function recruits(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  zone: ZoneThreat,
  hunterJob: number,
  want: number,
): Entity[] {
  const at = terrain.nodeAtClamped(zone.x, zone.y);
  const ranked: { e: Entity; rank: number }[] = [];
  for (const e of peopleNear(world, terrain, player, at, zone.radius)) {
    if (mayArm(world, ctx, e, hunterJob)) ranked.push({ e, rank: rankOf(world, ctx, e) });
  }
  // A stable sort keeps peopleNear's (distance, id) order within a rank.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, want).map((r) => r.e);
}

/** Whether `e` is a free grown-up civilian the seat may arm: alive, out of every shelter, tower, drill and
 *  fight, his trade his own to change, and the hunter's weapon one his tribe holds. */
function mayArm(world: World, ctx: SystemContext, e: Entity, hunterJob: number): boolean {
  if (!isAdultSettler(world, e)) return false;
  const settler = world.get(e, Settler);
  if (isFighterJob(ctx.content, settler.jobType) || isHunterJob(ctx.content, settler.jobType)) return false;
  if (settler.jobType === null || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return false;
  if (world.has(e, Militia) || world.has(e, AttackOrder) || world.has(e, Sheltering)) return false;
  if (world.has(e, Garrison) || world.has(e, TrainingOrder)) return false;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return false;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) return false;
  if (!mayChangeTrade(world, ctx.content, e) || atomicBlocksOrder(world, ctx, e)) return false;
  if (!canChooseJob(world, ctx, needSubjectOf(world, e), hunterJob)) return false;
  return attackerWeapon(ctx, settler.tribe, hunterJob) !== null;
}

function rankOf(world: World, ctx: SystemContext, e: Entity): number {
  const jobType = world.get(e, Settler).jobType;
  if (jobType !== null && isCarrierJob(ctx, jobType)) return CARRIER_RANK;
  return world.has(e, JobAssignment) || world.has(e, WorkFlag) ? WORKER_RANK : IDLE_RANK;
}

/** Make `e` a hunter of `zone`'s militia, remembering his trade and post, and send him at its raiders. */
function arm(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  zone: ZoneThreat,
  hunterJob: number,
): void {
  const previousJob = world.get(e, Settler).jobType;
  if (previousJob === null) return;
  const previousWorkplace = world.tryGet(e, JobAssignment)?.workplace ?? null;
  takeUpTrade(world, ctx, e, hunterJob);
  world.add(e, Militia, {
    zone: zone.anchor,
    leash: { at: terrain.nodeAtClamped(zone.x, zone.y), radius: zone.radius },
    previousJob,
    previousWorkplace,
    releaseTick: ctx.tick + MILITIA_HOLD_TICKS,
  });
  engage(world, ctx, terrain, e, zone);
}

/** Send `e` at the armed raider of `zone` nearest him, ascending (distance, id), on the militia's leash. An
 *  unarmed offender is the offender answer's, not the militia's. */
function engage(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity, zone: ZoneThreat): void {
  const at = entityNode(world, terrain, e);
  const x = terrain.xOf(at);
  const y = terrain.yOf(at);
  let target: Entity | null = null;
  let best = Number.POSITIVE_INFINITY;
  // The intruders arrive ascending id, so the strict `<` keeps the lower one on a tie.
  for (const intruder of zone.intruders) {
    if (!intruder.armed) continue;
    const distance = hexDistanceBetween(x, y, intruder.x, intruder.y);
    if (distance < best) {
      target = intruder.entity;
      best = distance;
    }
  }
  if (target === null) return;
  const origin = { player: world.get(e, Owner).player, source: 'settlement-defence' } as const;
  leashedAttack(world, ctx, e, target, { ...world.get(e, Militia).leash }, origin);
}

/**
 * Put `e` back to his old trade, at his old workplace when it still stands, is still the seat's and has
 * his seat open; otherwise unposted, for the economy to place. Answers false, keeping him armed, while a
 * clip holds him.
 */
function standDown(
  world: World,
  ctx: SystemContext,
  e: Entity,
  member: DeepReadonly<{ previousJob: number; previousWorkplace: Entity | null }>,
): boolean {
  if (atomicBlocksOrder(world, ctx, e)) return false;
  const { previousJob, previousWorkplace } = member;
  world.remove(e, Militia);
  const owner = world.get(e, Owner).player;
  if (
    previousWorkplace !== null &&
    world.isAlive(previousWorkplace) &&
    world.has(previousWorkplace, Building) &&
    world.tryGet(previousWorkplace, Owner)?.player === owner
  ) {
    assignWorker(world, ctx, {
      kind: 'assignWorker',
      entity: e,
      building: previousWorkplace,
      jobPriority: [previousJob],
    });
    if (world.tryGet(e, JobAssignment)?.workplace === previousWorkplace) return true;
  }
  takeUpTrade(world, ctx, e, previousJob);
  return true;
}
