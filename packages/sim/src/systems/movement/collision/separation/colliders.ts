import { Engagement, Obstructed, PathFollow, PathRoute, Position } from '../../../../components/index.js';
import { type Fixed, ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { worldX } from '../../../../nav/world-metric.js';
import type { SystemContext } from '../../../context.js';
import { isFighterJob } from '../../../readviews/index.js';
import { writeLegHeading } from '../../stepping.js';
import { softColliderSettler } from '../bodies.js';
import { hasBodyCollision } from '../owned-fighters.js';
import { standingPostGrid } from '../standing-posts.js';
import { worldYOf } from './geometry.js';
import type { ColliderColumns, MoverColumns, SeparationScratch } from './scratch.js';

/**
 * Fill this tick's mover columns and node grid, and hand over the post grid when a firm mover needs it.
 * False when nobody is walking - the dormancy exit, since nothing can overlap anything.
 */
export function collectColliders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  scratch: SeparationScratch,
): boolean {
  const { movers } = scratch;
  scratch.census++;
  // Ascending id, held by the world across ticks, so the census neither collects nor sorts the walkers.
  const walkers = world.canonicalQuery(PathFollow, Position);
  // Before the dormancy exit: a grind ends on arrival, a re-route, or a profession change out of the
  // fighting trades, and none of those walk, so its holder is never a mover.
  for (const e of world.canonicalQuery(Obstructed)) {
    if (!world.has(e, PathFollow) || !hasBodyCollision(world, ctx.content, e)) world.remove(e, Obstructed);
  }

  // The node grid needs every mover's Position; the route state only an overlapping pair reads is
  // captured on first ask by `moverHeading` and `moverGoal`.
  let moverCount = 0;
  let firmCount = 0;
  for (const e of walkers) {
    const settler = softColliderSettler(world, e);
    if (settler === undefined) continue;
    const slot = moverCount++;
    const p = world.get(e, Position);
    place(movers, slot, e, p.x, p.y);
    // `hasBodyCollision` with its Owner and Settler checks already passed by `softColliderSettler`.
    const firm = isFighterJob(ctx.content, settler.jobType);
    movers.firm[slot] = firm;
    if (firm) firmCount++;
  }
  movers.count = moverCount;
  if (moverCount === 0) return false;
  movers.grid.fill(terrain, moverCount, movers.hx, movers.hy);

  // Read once per census: posts never walk, so the resolve cannot move one, and a mover the grind halts
  // mid-pass stays out of the grid until the next census. Soft-only traffic never brings it up to date.
  scratch.posts = firmCount > 0 ? standingPostGrid(world, ctx.content, terrain) : undefined;
  return true;
}

function place(columns: ColliderColumns, slot: number, e: Entity, x: Fixed, y: Fixed): void {
  columns.entity[slot] = e;
  columns.x[slot] = x;
  columns.y[slot] = y;
  columns.worldX[slot] = worldX(x, y);
  columns.worldY[slot] = worldYOf(y);
  columns.hx[slot] = nodeHxOfPosition(x, y);
  columns.hy[slot] = nodeHyOfPosition(y);
}

/**
 * Mover `slot`'s route goal and combat status, captured on the census's first ask. Only an aligned
 * overlapping pair and a firm mover's post test read them, and a mover's own resolve meets each pair before
 * its grind bookkeeping can rewrite its route, so a late capture reads what the census would have.
 */
export function moverGoal(world: World, scratch: SeparationScratch, slot: number): void {
  const movers: MoverColumns = scratch.movers;
  if (movers.goalCensus[slot] === scratch.census) return;
  movers.goalCensus[slot] = scratch.census;
  const e = movers.entity[slot];
  if (e === undefined) return; // a census slot, so only for the type
  // Present by the census's walkers query.
  const waypoints = world.get(e, PathRoute).waypoints;
  const goal = waypoints[waypoints.length - 1];
  movers.hasGoal[slot] = goal !== undefined;
  movers.goalX[slot] = goal?.x ?? ZERO;
  movers.goalY[slot] = goal?.y ?? ZERO;
  movers.engaged[slot] = world.has(e, Engagement);
}

/** Mover `slot`'s unit world heading toward its leg target, zero without one; derived once per census, on
 *  the same first-ask terms as {@link moverGoal}. */
export function moverHeading(world: World, scratch: SeparationScratch, slot: number): void {
  const movers: MoverColumns = scratch.movers;
  if (movers.headingCensus[slot] === scratch.census) return;
  movers.headingCensus[slot] = scratch.census;
  const e = movers.entity[slot];
  if (e === undefined) return; // a census slot, so only for the type
  // Both present by the census's walkers query.
  const target = world.get(e, PathRoute).waypoints[world.get(e, PathFollow).index];
  const out = scratch.heading;
  if (target !== undefined) {
    const from = scratch.headingFrom;
    const to = scratch.headingTo;
    from.x = movers.x[slot] ?? ZERO;
    from.y = movers.y[slot] ?? ZERO;
    to.x = target.x;
    to.y = target.y;
    writeLegHeading(from, to, out);
  } else {
    out.hx = ZERO;
    out.hy = ZERO;
  }
  movers.headingX[slot] = out.hx;
  movers.headingY[slot] = out.hy;
}
