import { Health, MoveGoal, Settler, StayPoint, WildHabitat, YoungAnimal } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, Traversal } from '../../nav/terrain/index.js';
import { angryAnimal } from '../conflict/targeting.js';
import type { SystemContext } from '../context.js';
import { herdLeaderOf, leadItself } from '../movement/herd-leader.js';
import { followSpot } from '../movement/herding.js';
import { isTravelling } from '../movement/nav-state.js';
import { settlerMovementNode, settlerTraversal } from '../movement/traversal.js';
import { herdParams } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { animalClipTicks, EAT_ATOMIC, idleClipTicks } from './clips.js';
import {
  goAwayPoint,
  grassNear,
  isGrass,
  nextGrazePoint,
  settleStayPoint,
  stayRangeOf,
  type WalkGround,
} from './range.js';

/** Original behavior: a meal adds 100..499 to an animal's hunger and a tenth of that to its hitpoints. */
const MEAL_MIN = 100;
const MEAL_SPREAD = 400;
const MEAL_HEAL_DIVISOR = 10;
/** Original behavior: a hostile adult eats nothing, and each decision costs its own food one, its fight
 *  over or not. */
const HOSTILE_FOOD_COST = 1;
/** Original behavior: one idle decision in five sends the animal to a nearby free point instead. */
const GO_AWAY_ODDS = 5;
/** How near its graze point a leader must end its leg for the leg to count as reached. Approximation:
 *  a walk that ends in a crowd stops beside the point rather than on it. */
const GRAZE_ARRIVAL_SLACK = 2;

/** One pass's shared walk state: the ground every target is tested against and the spots followers took. */
export interface StayPass extends WalkGround {
  readonly ctx: SystemContext;
  readonly taken: Set<NodeId>;
}

/**
 * Original behavior, an animal's stay decision, made when its last clip or walk ends. A hungry animal eats
 * (grass under it) or walks to grass within `maximumleaderdistance`; a hostile adult skips the meal. A
 * leader then heads for a new graze point when its food is used up or it stands farther than
 * `maximumdistancetostaypoint` plus `maximumdistancetobirthpoint` from its birth point, walks back when
 * farther than `maximumdistancetostaypoint` from its stay point, and otherwise idles. A follower joins its
 * leader when farther than `maximumleaderdistance` from it or when the leader is on a graze leg, and
 * otherwise idles.
 */
export function stayDecision(world: World, pass: StayPass, e: Entity): void {
  const { ctx, terrain } = pass;
  const herd = herdParams(ctx.content, world.get(e, Settler).tribe);
  if (herd === null) {
    idle(world, pass, e);
    return;
  }
  const here = settlerMovementNode(world, terrain, e);
  const traversal = settlerTraversal(world, e);
  const leader = herdLeaderOf(world, e);
  const reached = world.get(e, WildHabitat).nextPoint;
  if (reached !== undefined) {
    if (leader === e && hexNodeDistance(terrain, here, reached) <= GRAZE_ARRIVAL_SLACK) {
      settleStayPoint(world, terrain, e, here);
    }
    world.mut(e, WildHabitat).nextPoint = undefined;
  }

  if (hostileAdult(world, ctx, e)) {
    world.mut(e, WildHabitat).food -= HOSTILE_FOOD_COST;
  } else if (world.get(e, WildHabitat).fedUntil - ctx.tick < 1 && traversal === 'land') {
    // Approximation: a swimmer has no grass and never feeds.
    eat(world, pass, e, leader, here, herd.leaderDistance, traversal);
    return;
  }
  if (leader !== e) {
    followerStays(world, pass, e, leader, here, herd.leaderDistance, herd.maxGroupSize, traversal);
    return;
  }
  const habitat = world.get(e, WildHabitat);
  const stay = world.get(e, StayPoint).cell;
  const stayRange = stayRangeOf(world, e, herd.stayPointRange);
  if (hexNodeDistance(terrain, here, habitat.birth) > stayRange + herd.birthPointRange) {
    world.mut(e, WildHabitat).food = 0;
    goToNextPoint(world, pass, e, here, traversal);
  } else if (habitat.food < 1) {
    goToNextPoint(world, pass, e, here, traversal);
  } else if (hexNodeDistance(terrain, here, stay) > stayRange) {
    walkTo(world, pass, e, here, stay);
  } else {
    idleOrGoAway(world, pass, e, here, traversal);
  }
}

/** Original behavior: an adult of an aggressive species, or a provoked one whose anger still runs, is
 *  hostile. */
function hostileAdult(world: World, ctx: SystemContext, e: Entity): boolean {
  return !world.has(e, YoungAnimal) && angryAnimal(world, ctx, e, world.get(e, Settler).tribe);
}

/**
 * The stay decision of an animal its anger alone holds: a hostile adult spends one food, then a leader
 * farther than its stay range from its stay point walks back to it, and otherwise the animal idles where it
 * stands. Original behavior: a leader that dropped its target at the leash walks home at once.
 * Approximation: the original's angry animal also follows its leader and grazes its range; here it stands
 * inside its range until the anger lapses, so the fight search, which skips walkers, keeps running. Answers
 * whether it decided; a provoked young one, or one whose anger lapsed, waits as before.
 */
export function angryStay(world: World, pass: StayPass, e: Entity): boolean {
  if (!hostileAdult(world, pass.ctx, e)) return false;
  world.mut(e, WildHabitat).food -= HOSTILE_FOOD_COST;
  const herd = herdParams(pass.ctx.content, world.get(e, Settler).tribe);
  const stay = world.tryGet(e, StayPoint)?.cell;
  if (herd !== null && stay !== undefined && herdLeaderOf(world, e) === e) {
    const here = settlerMovementNode(world, pass.terrain, e);
    if (hexNodeDistance(pass.terrain, here, stay) > stayRangeOf(world, e, herd.stayPointRange)) {
      walkTo(world, pass, e, here, stay);
      return true;
    }
  }
  idle(world, pass, e);
  return true;
}

function eat(
  world: World,
  pass: StayPass,
  e: Entity,
  leader: Entity,
  here: NodeId,
  range: number,
  traversal: Traversal,
): void {
  const { ctx, terrain } = pass;
  if (!isGrass(terrain, here)) {
    const grass = grassNear(pass, here, range, traversal);
    if (grass !== null) walkTo(world, pass, e, here, grass);
    else if (leader === e) goToNextPoint(world, pass, e, here, traversal);
    else idle(world, pass, e);
    return;
  }
  const meal = MEAL_MIN + ctx.rng.int(MEAL_SPREAD);
  const habitat = world.mut(e, WildHabitat);
  habitat.fedUntil += meal;
  habitat.nextStayAt = ctx.tick + animalClipTicks(ctx.content, world.get(e, Settler), EAT_ATOMIC);
  const health = world.tryGet(e, Health);
  if (health !== undefined && health.hitpoints < health.max) {
    const healed = world.mut(e, Health);
    healed.hitpoints = Math.min(healed.max, healed.hitpoints + Math.floor(meal / MEAL_HEAL_DIVISOR));
  }
  if (world.has(leader, WildHabitat)) world.mut(leader, WildHabitat).food -= meal;
}

function followerStays(
  world: World,
  pass: StayPass,
  e: Entity,
  leader: Entity,
  here: NodeId,
  range: number,
  maxGroupSize: number,
  traversal: Traversal,
): void {
  const { terrain } = pass;
  const leaderNode = settlerMovementNode(world, terrain, leader);
  const leg = isTravelling(world, leader) ? world.tryGet(leader, WildHabitat)?.nextPoint : undefined;
  if (leg === undefined && hexNodeDistance(terrain, here, leaderNode) <= range) {
    idleOrGoAway(world, pass, e, here, traversal);
    return;
  }
  const centre = leg ?? leaderNode;
  if (terrain.componentOf(centre) !== terrain.componentOf(here)) {
    leaveHerd(world, pass, e, here, maxGroupSize);
    return;
  }
  walkTo(
    world,
    pass,
    e,
    here,
    followSpot(terrain, pass.fields, pass.taken, pass.blocked, here, centre, range, traversal),
  );
}

/**
 * Original behavior: a follower whose walk to its leader fails leaves that herd and, of a species that
 * herds at all, leads itself, then idles. Approximation: it resets its grazing as the leadership drive's
 * new leader does; the walk counts as failed before it starts when its target lies off the follower's
 * island, and one a building or wall blocks is not caught here.
 */
function leaveHerd(world: World, pass: StayPass, e: Entity, here: NodeId, maxGroupSize: number): void {
  leadItself(world, e, here, maxGroupSize);
  idle(world, pass, e);
}

function goToNextPoint(world: World, pass: StayPass, e: Entity, here: NodeId, traversal: Traversal): void {
  const target = nextGrazePoint(pass, pass.ctx.rng, world.get(e, WildHabitat).workCenter, here, traversal);
  if (target === null || target === here) {
    idle(world, pass, e);
    return;
  }
  world.mut(e, WildHabitat).nextPoint = target;
  world.add(e, MoveGoal, { cell: target });
}

function idleOrGoAway(world: World, pass: StayPass, e: Entity, here: NodeId, traversal: Traversal): void {
  const spot = pass.ctx.rng.int(GO_AWAY_ODDS) === 0 ? goAwayPoint(pass, pass.ctx.rng, here, traversal) : null;
  if (spot !== null) walkTo(world, pass, e, here, spot);
  else idle(world, pass, e);
}

function idle(world: World, pass: StayPass, e: Entity): void {
  const { ctx } = pass;
  world.mut(e, WildHabitat).nextStayAt =
    ctx.tick + idleClipTicks(ctx.content, ctx.rng, world.get(e, Settler));
}

/** A walk the decision ends in; the animal decides again when it stands free. */
function walkTo(world: World, pass: StayPass, e: Entity, here: NodeId, target: NodeId): void {
  if (target === here) idle(world, pass, e);
  else world.add(e, MoveGoal, { cell: target });
}
