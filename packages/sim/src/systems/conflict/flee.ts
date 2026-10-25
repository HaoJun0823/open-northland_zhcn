import {
  AttackOrder,
  Carrying,
  Fleeing,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  PathRequest,
  PlayerOrder,
  type SettlerIdentity,
  SettlerNeeds,
  Sheltering,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { needLevel } from '../lifecycle/needs/levels.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { settlerMovementNode, settlerTraversal } from '../movement/traversal.js';
import { isFighterJob, type MilitaryMode, stanceFights } from '../readviews/index.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { startDrop } from '../settlers/atomics/start.js';
import { COMPASS_DIRECTIONS } from '../spatial/nodes.js';
import { parkHaulingCart, pullsHaulingCart } from '../vehicles/hauling-cart.js';

// The run a blow starts for anyone who is not a fighter. Original behavior: no one runs at the mere sight
// of an enemy.

/** A carrier pulling its cart parks it where it stands, the load stowed, since no gesture drops a cart's
 *  load; anyone else plays the drop clip. */
function shedLoad(world: World, ctx: SystemContext, e: Entity): void {
  if (pullsHaulingCart(world, e)) parkHaulingCart(world, ctx, e);
  else startDrop(world, ctx, e);
}

/**
 * How many half-cell nodes a struck unit runs from its attacker, and a frightened animal from its scare,
 * along one of the eight walk directions. The original runs a struck civilian 10 map points from its
 * attacker; this is 10 map points along a row or a column and up to 15 on a diagonal, an approximation.
 */
export const FLEE_STEP_NODES = 10;

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a collapsing hunger or fatigue keeps a struck
 * unit from running, while every lesser need yields to the run. Set well above the 3/4 eat/sleep
 * thresholds. Approximated (source basis "Combat flee"): the original's flee-vs-need arbitration is
 * unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/**
 * Who runs from a blow on itself or beside it: anyone who is not a fighter, under any stance but one the
 * player set to fight. Original behavior: every non-soldier runs whatever its stance. Deviation: a civilian
 * the player set to ATTACK or DEFEND stands, as that setting says; a fighter's answer is to turn, never run.
 */
export function runsFromBlows(ctx: SystemContext, runner: SettlerIdentity, mode: MilitaryMode): boolean {
  return !isFighterJob(ctx.content, runner.jobType) && !stanceFights(mode);
}

/**
 * Start `e` running a {@link FLEE_STEP_NODES} step away from `from`, the node a blow on it or on a
 * neighbour came from. Original behavior. It stands instead while already running, sheltering, under a
 * player's order, too worn out to run or script-passive: gates of this sim's own (approximation: the
 * original's own gates are not all mapped onto these). A runner a clip holds, the struck one flinching or
 * a worker mid-stroke, owes the run until the clip ends, and one that carries a haul sets it down first.
 * The run is the whole reaction: the unit goes back to its work where it ends.
 */
export function runFromBlow(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  from: NodeId,
): void {
  if (world.has(e, Fleeing) || world.has(e, Sheltering) || world.has(e, PlayerOrder)) return;
  if (world.has(e, AttackOrder) || needCollapsing(world, ctx.tick, e)) return;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return; // a script-passive unit stands and takes it
  world.add(e, Fleeing, { blow: from });
  if (!atomicHoldsSettler(world, e)) startBlowRun(world, ctx, terrain, e);
}

/**
 * Issue the run `e` owes for a blow: drop a haul first (the drop clip re-owes it), else route away from
 * the blow's node and clear the debt. Answers whether the runner is still on its way, walking or dropping;
 * a boxed-in one has nowhere to run and its debt is cleared with it standing. A run whose route the
 * routing refused ends where the runner stands: the away-cell was walkable but sealed off, and a runner left
 * holding the failed request would stay fleeing for good, since only the marker's owner re-plans it.
 */
export function startBlowRun(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): boolean {
  const fleeing = world.get(e, Fleeing);
  const from = fleeing.blow;
  if (from === undefined) {
    if (world.tryGet(e, PathRequest)?.failed !== true) return isTravelling(world, e);
    clearNavState(world, e);
    return false;
  }
  if (world.has(e, Carrying)) {
    shedLoad(world, ctx, e);
    return true;
  }
  world.mut(e, Fleeing).blow = undefined;
  const here = settlerMovementNode(world, terrain, e);
  const dest = fleeDestination(
    terrain,
    dynamicBlockOverlay(world, ctx, terrain),
    here,
    [from],
    undefined,
    undefined,
    settlerTraversal(world, e),
  );
  if (dest === here) {
    clearNavState(world, e);
    return false;
  }
  redirectRoute(world, e, dest);
  return true;
}

/** The cell a fleeing unit should run to: the cell `step` nodes away, of the eight compass directions, that is
 *  farthest from the nearest threat in `threatCells`, so a runner does not head from one threat at another,
 *  then farthest from them all together, which picks the gap in a ring of threats, tie-broken by min cell
 *  id. Distances are map points. Where `admits` refuses that cell, the direction's nearer cells stand in
 *  for it, the farthest admitted first. A candidate must be one a route can reach: walkable, outside the
 *  `blocked` walk-block, and in the runner's static walk component (a runner on an unwalkable node is
 *  unlabelled and admits every component). It must also strictly beat staying put, so a boxed-in unit
 *  returns `here` rather than running toward a threat. */
export function fleeDestination(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  here: NodeId,
  threatCells: readonly NodeId[],
  step: number = FLEE_STEP_NODES,
  admits: (cell: NodeId) => boolean = () => true,
  traversal: Traversal = 'land',
): NodeId {
  const h = terrain.coordsOf(here);
  const threats = threatCells.map((t) => terrain.coordsOf(t));
  const bank = terrain.componentOf(here);
  let best: NodeId = here;
  // A candidate must beat staying put.
  let bestClearance = nearestThreat(threats, h.x, h.y);
  let bestTotal = allThreats(threats, h.x, h.y);
  for (const [dx, dy] of COMPASS_DIRECTIONS) {
    if (!terrain.inBounds(h.x + dx * step, h.y + dy * step)) continue;
    let reach = step;
    while (reach > 0 && !admits(terrain.nodeAt(h.x + dx * reach, h.y + dy * reach))) reach--;
    if (reach === 0) continue;
    const x = h.x + dx * reach;
    const y = h.y + dy * reach;
    const cell = terrain.nodeAt(x, y);
    if (!terrain.traversable(cell, traversal) || blocked.has(cell)) continue;
    if (bank >= 0 && terrain.componentOf(cell) !== bank) continue;
    const clearance = nearestThreat(threats, x, y);
    const total = allThreats(threats, x, y);
    const better =
      clearance !== bestClearance
        ? clearance > bestClearance
        : total !== bestTotal
          ? total > bestTotal
          : best !== here && cell < best;
    if (better) {
      best = cell;
      bestClearance = clearance;
      bestTotal = total;
    }
  }
  return best;
}

type NodeCoords = { readonly x: number; readonly y: number };

/** The map-point distance from node (x, y) to the nearest of `threats`, as the threat search measures. */
function nearestThreat(threats: readonly NodeCoords[], x: number, y: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const t of threats) min = Math.min(min, hexDistanceBetween(x, y, t.x, t.y));
  return min;
}

/** The summed map-point distance from node (x, y) to every one of `threats`. */
function allThreats(threats: readonly NodeCoords[], x: number, y: number): number {
  let sum = 0;
  for (const t of threats) sum += hexDistanceBetween(x, y, t.x, t.y);
  return sum;
}

/** Whether a settler's hunger or fatigue has reached the {@link NEED_COLLAPSE_THRESHOLD}, at which it stops
 *  to eat or sleep even in danger. */
function needCollapsing(world: World, tick: number, e: Entity): boolean {
  const s = world.get(e, SettlerNeeds);
  return (
    needLevel(s, 'hunger', tick) >= NEED_COLLAPSE_THRESHOLD ||
    needLevel(s, 'fatigue', tick) >= NEED_COLLAPSE_THRESHOLD
  );
}
