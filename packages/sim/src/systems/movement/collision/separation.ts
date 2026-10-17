import { Owner, Position } from '../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { positionXOfWorld } from '../../../nav/halfcell.js';
import { ROW_STEP, worldDistance, worldX } from '../../../nav/world-metric.js';
import type { System } from '../../context.js';
import { REFERENCE_PACE_PER_TICK, walkPacePerTick } from '../system.js';
import { collectColliders, moverHeading, moverRoute } from './separation/colliders.js';
import { SeparationGates } from './separation/gates.js';
import { gridYOf, worldYOf } from './separation/geometry.js';
import {
  clearGrind,
  OBSTRUCTED_MAX_REROUTES,
  OBSTRUCTED_PROGRESS_FLOOR,
  OBSTRUCTED_REROUTE_TICKS,
  updateObstruction,
} from './separation/obstruction.js';
import {
  type MoverColumns,
  type ScratchPoint,
  type SeparationScratch,
  separationScratch,
} from './separation/scratch.js';

export { OBSTRUCTED_MAX_REROUTES, OBSTRUCTED_PROGRESS_FLOOR, OBSTRUCTED_REROUTE_TICKS };

/**
 * A collider's body radius, in world-metric column units. Both half-cell lattice pitches bound it: above
 * half the E/W node pitch (0.25), so posts on horizontally adjacent nodes leave no slip line and a
 * one-per-node line is a closed wall, and below the N/S node pitch (19/68 ~ 0.2794), so a post never covers
 * a neighbouring node's centre and every free node stays exactly reachable. Impassability holds because a
 * mover advances at most `MAX_STEP_PER_TICK` plus {@link SEPARATION_PUSH_CAP} per tick, always less than
 * this radius.
 */
const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/** `fx.isqrt(d) >= UNIT_SEPARATION_RADIUS` exactly when `d * ONE` reaches this raw square, so a pair out
 *  of reach is rejected before taking its root. */
const UNIT_SEPARATION_RADIUS_SQUARED_SCALED = UNIT_SEPARATION_RADIUS * UNIT_SEPARATION_RADIUS;

/**
 * The per-tick cap on the soft mover-vs-mover push, below the reference walker's per-tick advance so a
 * walker brushed by passing traffic still makes net progress every tick; {@link SOFT_PUSH_PACE_SHARE}
 * lowers it further for slower legs (snow, laden, script-slowed). Approximation: two fifths of the
 * reference pace.
 */
const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(REFERENCE_PACE_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

/**
 * The share of a mover's own pace its soft push may reach. Below one, so a slow leg pushed straight back
 * by head-on or converging traffic still gains ground each tick instead of settling where push and step
 * cancel, which held such walkers in place until they starved.
 */
const SOFT_PUSH_PACE_SHARE: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * Minimum heading alignment for converging or same-lane walkers to brake behind one another. Abreast
 * walkers with distinct destinations separate sideways; a common heading must not fold a marching
 * front into a column. Combat and a shared destination retain their orderly approach.
 * Approximation: headings within 60 degrees, and for distinct goals the neighbour twice as far along as across.
 */
const CONVOY_ALIGNMENT_MIN: Fixed = fx.div(fx.fromInt(1), fx.fromInt(2));

/**
 * Resolves this tick's body overlaps, right after the MovementSystem; `bodies.ts` holds the tier model and
 * its source basis. Only movers are displaced: a mover-vs-mover overlap resolves softly, as a convoy brake
 * or a radial split of half the overlap each, while a firm mover additionally ejects fully back onto the
 * radius of a post that blocks it, an enemy's or a friend's on its goal node, so such a post is impenetrable
 * but never jitters. A displaced position must land
 * on walkable, unblocked ground, or the offending axis and then the whole displacement is discarded.
 *
 * Movers are processed in ascending entity id, mover-vs-mover pushes read the tick's pre-separation
 * snapshot, and post resolutions apply in bucket-scan order, so no result depends on store order.
 */
export const separationSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no lattice to collide on

  const scratch = separationScratch(world);
  // Nobody walking, so nothing can overlap anything.
  if (!collectColliders(world, ctx, terrain, scratch)) return;
  const { movers, posts, nearMovers, nearPosts, push, candidate } = scratch;
  scratch.gates ??= new SeparationGates(world, ctx, terrain);
  const gates = scratch.gates;
  gates.reset(ctx, terrain);

  for (let slot = 0; slot < movers.count; slot++) {
    const e = movers.entity[slot];
    if (e === undefined) continue; // slot < count, so only for the type
    const nodeHx = movers.hx[slot] ?? 0;
    const nodeHy = movers.hy[slot] ?? 0;
    const isFirm = movers.firm[slot] === true;

    // The radius is below both bucket pitches, so every body within reach lives in the 3x3 node block
    // around the mover's own node. Posts matter only to a firm mover.
    const postGrid = isFirm ? posts : undefined;
    // The mover's own slot sits in its own node's list; neighbours are the rest.
    const moverCount = movers.grid.collectAround(nodeHx, nodeHy, slot, nearMovers);
    let postCount = 0;
    if (postGrid !== undefined) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          postCount = postGrid.collect(nodeHx + dx, nodeHy + dy, nearPosts, postCount);
        }
      }
    }
    if (moverCount === 0 && postCount === 0) {
      if (isFirm) clearGrind(world, e);
      continue;
    }
    moverRoute(world, scratch, slot);
    let player: number | undefined;
    if (postCount > 0) {
      player = world.get(e, Owner).player;
      const goal =
        movers.hasGoal[slot] === true
          ? gates.nodeAt(movers.goalX[slot] ?? ZERO, movers.goalY[slot] ?? ZERO)
          : undefined;
      postCount = gates.keepBlockingPosts(player, goal, nearPosts, postCount);
    }
    if (moverCount === 0 && postCount === 0) {
      if (isFirm) clearGrind(world, e);
      continue;
    }
    // A firm mover in its own town drops to the soft tier: no post resolve and no grind.
    const ghost = isFirm && gates.isGhost(player ?? world.get(e, Owner).player, nodeHx, nodeHy);

    const pushMagnitude = resolveMoverPush(world, scratch, slot, moverCount, push);
    if (push.x !== ZERO || push.y !== ZERO) capToOwnPace(push, pushMagnitude, walkPacePerTick(world, ctx, e));

    // The census Position: no earlier mover's resolve writes this one's.
    const px = movers.x[slot] ?? ZERO;
    const py = movers.y[slot] ?? ZERO;
    candidate.x = px;
    candidate.y = py;
    if (push.x !== ZERO || push.y !== ZERO) {
      const y = gridYOf(fx.add(movers.worldY[slot] ?? ZERO, push.y));
      candidate.x = positionXOfWorld(fx.add(movers.worldX[slot] ?? ZERO, push.x), y);
      candidate.y = y;
    }

    // Only a firm mover outside its own calm zone ejects off posts; everyone else keeps the soft candidate.
    if (!ghost) resolveAgainstPosts(world, e, candidate, nearPosts, postCount);

    // Drop the offending axis, then the whole displacement: the walker's own path point always stands.
    // Mut only on a landed displacement, so a crowd standing in equilibrium does not churn the touched log.
    if (candidate.x !== px || candidate.y !== py) {
      if (gates.allowsLanding(candidate.x, candidate.y)) {
        const moved = world.mut(e, Position);
        moved.x = candidate.x;
        moved.y = candidate.y;
      } else if (gates.allowsLanding(candidate.x, py)) {
        world.mut(e, Position).x = candidate.x;
      } else if (gates.allowsLanding(px, candidate.y)) {
        world.mut(e, Position).y = candidate.y;
      }
    }

    // Only a firm mover outside its calm zone keeps a grind window, so only it pays the neighbour scan.
    if (isFirm) {
      const firmNear = !ghost && (postCount > 0 || someFirm(movers, nearMovers, moverCount));
      updateObstruction(world, terrain, e, movers.legCost[slot] ?? 0, ghost, firmNear);
    }
  }
};

/**
 * The soft tier: this mover's mover-vs-mover push for the tick, written to `push` in world axes. Read from
 * the pre-separation columns alone so the pairwise split is order-independent, and capped at
 * {@link SEPARATION_PUSH_CAP}. Each pair adds an exact integer term, so neighbour order cannot change it.
 * Returns the written push's magnitude.
 */
function resolveMoverPush(
  world: World,
  scratch: SeparationScratch,
  slot: number,
  moverCount: number,
  push: ScratchPoint,
): Fixed {
  const { movers, nearMovers } = scratch;
  const { entity, y, worldX: wx, worldY: wy, headingX, headingY } = movers;
  const e = entity[slot] ?? 0;
  const startY = y[slot] ?? ZERO;
  const startWX = wx[slot] ?? ZERO;
  const startWY = wy[slot] ?? ZERO;
  let pushX = ZERO;
  let pushY = ZERO;
  for (let i = 0; i < moverCount; i++) {
    const other = nearMovers[i];
    if (other === undefined) continue;
    const otherWX = wx[other] ?? ZERO;
    const dwx = fx.sub(otherWX, startWX);
    // Scale the row difference before rounding, as worldDistance does. Subtracting rounded world Y
    // positions instead would change fractional-row distances by an ulp.
    const dwy = fx.mul(fx.sub(y[other] ?? ZERO, startY), ROW_STEP);
    const squared = fx.add(fx.mul(dwx, dwx), fx.mul(dwy, dwy));
    if (squared * ONE >= UNIT_SEPARATION_RADIUS_SQUARED_SCALED) continue;
    const dist = fx.isqrt(squared);
    const n = entity[other] ?? 0;
    const half = fx.div(fx.sub(UNIT_SEPARATION_RADIUS, dist), fx.fromInt(2));
    const otherWY = wy[other] ?? ZERO;
    moverHeading(world, scratch, slot);
    moverHeading(world, scratch, other);
    const startHX = headingX[slot] ?? ZERO;
    const startHY = headingY[slot] ?? ZERO;
    const otherHX = headingX[other] ?? ZERO;
    const otherHY = headingY[other] ?? ZERO;
    // (0, 0) is the "no established heading" sentinel: such a pair falls through to the radial split.
    if ((startHX !== ZERO || startHY !== ZERO) && (otherHX !== ZERO || otherHY !== ZERO)) {
      const alignment = fx.add(fx.mul(startHX, otherHX), fx.mul(startHY, otherHY));
      if (alignment >= CONVOY_ALIGNMENT_MIN) {
        const ahead = fx.add(
          fx.mul(fx.sub(otherWX, startWX), startHX),
          fx.mul(fx.sub(otherWY, startWY), startHY),
        );
        const across = fx.sub(fx.mul(dwx, startHY), fx.mul(dwy, startHX));
        const otherAhead = fx.add(
          fx.mul(fx.sub(startWX, otherWX), otherHX),
          fx.mul(fx.sub(startWY, otherWY), otherHY),
        );
        const otherAcross = fx.sub(fx.mul(dwx, otherHY), fx.mul(dwy, otherHX));
        const sharedGoal =
          movers.hasGoal[slot] === true &&
          movers.hasGoal[other] === true &&
          movers.goalX[slot] === movers.goalX[other] &&
          movers.goalY[slot] === movers.goalY[other];
        const sameLane =
          sharedGoal ||
          movers.engaged[slot] === true ||
          movers.engaged[other] === true ||
          (Math.abs(ahead) >= 2 * Math.abs(across) && Math.abs(otherAhead) >= 2 * Math.abs(otherAcross));
        // Exactly stacked on the same lane: the higher id yields, seeding the fore and aft order the
        // geometric test then keeps stable. A faster follower can still out-close the capped brake.
        if (sameLane && (ahead > ZERO || (ahead === ZERO && e > n))) {
          pushX = fx.sub(pushX, fx.mul(startHX, half));
          pushY = fx.sub(pushY, fx.mul(startHY, half));
          continue; // braked in line, no radial component
        }
        // The leader skips its counter-shove only when the other side will brake. Both iterations read the
        // same snapshot, so this prediction equals the other side's own decision exactly.
        if (sameLane && (otherAhead > ZERO || (otherAhead === ZERO && n > e))) continue;
      }
    }
    if (dist === ZERO) {
      // Exactly stacked crossing traffic: split along E/W by id order, a named pick.
      pushX = fx.add(pushX, e < n ? fx.sub(ZERO, half) : half);
    } else {
      pushX = fx.add(pushX, fx.mulDiv(fx.sub(startWX, otherWX), half, dist));
      pushY = fx.add(pushY, fx.mulDiv(fx.sub(startWY, otherWY), half, dist));
    }
  }
  push.x = pushX;
  push.y = pushY;
  if (pushX === ZERO && pushY === ZERO) return ZERO;
  const mag = magnitudeOf(push);
  if (mag <= SEPARATION_PUSH_CAP) return mag;
  push.x = fx.mulDiv(pushX, SEPARATION_PUSH_CAP, mag);
  push.y = fx.mulDiv(pushY, SEPARATION_PUSH_CAP, mag);
  // The truncated components no longer measure the cap exactly.
  return magnitudeOf(push);
}

function magnitudeOf(v: ScratchPoint): Fixed {
  return fx.isqrt(fx.add(fx.mul(v.x, v.x), fx.mul(v.y, v.y)));
}

/** Scale `push`, of magnitude `mag`, down to {@link SOFT_PUSH_PACE_SHARE} of the mover's `pace`; a mover
 *  with no pace keeps it. */
function capToOwnPace(push: ScratchPoint, mag: Fixed, pace: Fixed | null): void {
  if (pace === null) return;
  const cap = fx.mul(pace, SOFT_PUSH_PACE_SHARE);
  if (mag <= cap) return;
  push.x = fx.mulDiv(push.x, cap, mag);
  push.y = fx.mulDiv(push.y, cap, mag);
}

/**
 * The firm tier: move `cand` back onto the radius of each post it overlaps, in the bucket-scan order the
 * caller passes `nearPosts` in, so the last overlapped post in that order wins a conflict.
 */
function resolveAgainstPosts(
  world: World,
  e: Entity,
  cand: ScratchPoint,
  nearPosts: readonly Entity[],
  postCount: number,
): void {
  for (let i = 0; i < postCount; i++) {
    const s = nearPosts[i];
    if (s === undefined) continue;
    const post = world.get(s, Position);
    const dist = worldDistance(cand.x, cand.y, post.x, post.y);
    if (dist >= UNIT_SEPARATION_RADIUS) continue;
    const postWX = worldX(post.x, post.y);
    const postWY = worldYOf(post.y);
    let outX: Fixed;
    let outY: Fixed;
    if (dist === ZERO) {
      // Exactly on the post: eject east/west by id order (a named pick).
      outX = e < s ? fx.sub(ZERO, UNIT_SEPARATION_RADIUS) : UNIT_SEPARATION_RADIUS;
      outY = ZERO;
    } else {
      outX = fx.mulDiv(fx.sub(worldX(cand.x, cand.y), postWX), UNIT_SEPARATION_RADIUS, dist);
      outY = fx.mulDiv(fx.sub(worldYOf(cand.y), postWY), UNIT_SEPARATION_RADIUS, dist);
    }
    const y = gridYOf(fx.add(postWY, outY));
    cand.x = positionXOfWorld(fx.add(postWX, outX), y);
    cand.y = y;
  }
}

function someFirm(movers: MoverColumns, near: readonly number[], count: number): boolean {
  for (let i = 0; i < count; i++) {
    const n = near[i];
    if (n !== undefined && movers.firm[n] === true) return true;
  }
  return false;
}
