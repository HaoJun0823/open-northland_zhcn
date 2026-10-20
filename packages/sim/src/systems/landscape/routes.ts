import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Stranded,
  UnreachableGoals,
  VehicleYardRefusals,
  type Waypoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { dropPath } from '../movement/nav-state.js';
import { type NodeBounds, nodeBoundsOf, routeBoundsOf } from '../movement/route-bounds.js';
import { routeStartCell } from '../movement/route-start.js';
import { settlerTraversal } from '../movement/traversal.js';

/** A script closes topology immediately; keep the same safe stopping path as a wall closure. */
export function invalidateLandscapeRoutes(
  world: World,
  terrain: TerrainGraph,
  closed: ReadonlySet<NodeId>,
): void {
  forgetRouteFailures(world, terrain);
  invalidateRoutesThrough(world, terrain, closed);
}

/** An opening may invalidate a pending refusal. Keep its recovery deadline until budgeted routing
 * proves the walk works; unrelated openings therefore cannot keep a genuine failure parked forever. */
export function retryFailedRoutes(world: World, terrain: TerrainGraph): void {
  const failed = [...world.query(PathRequest, Position)].filter((e) => world.get(e, PathRequest).failed);
  for (const e of failed) requestFromHere(world, terrain, e, world.get(e, PathRequest).retainRoute === true);
}

/** Drop every remembered unreachable goal, stranded park and refused vehicle yard, so a way or ground a
 *  script opened is tried again at once rather than when the memo runs out. */
export function forgetRouteFailures(world: World, terrain: TerrainGraph): void {
  retryFailedRoutes(world, terrain);
  for (const e of [...world.query(Stranded)]) world.remove(e, Stranded);
  for (const e of [...world.query(UnreachableGoals)]) world.remove(e, UnreachableGoals);
  for (const e of [...world.query(VehicleYardRefusals)]) world.remove(e, VehicleYardRefusals);
}

/** Whether any walker follows a route, which a closing could cut. */
export function anyRouteFollowed(world: World): boolean {
  return world.query(PathFollow, PathRoute, Position).next().done !== true;
}

/**
 * A walker whose remaining route crosses one of `cells` stops short of them and searches again, so a gate
 * shut or a wall finished in front of it is never walked through. Costs one bounds test per walker, and
 * the remaining stops of the routes whose bounds take in a closed cell.
 */
export function invalidateRoutesThrough(
  world: World,
  terrain: TerrainGraph,
  cells: ReadonlySet<NodeId>,
): void {
  if (cells.size === 0) return;
  const closed = nodeBoundsOf(terrain, cells);
  const crossing: { e: Entity; stop: number }[] = [];
  for (const e of world.query(PathFollow, PathRoute, Position)) {
    const waypoints = world.get(e, PathRoute).waypoints;
    if (!boundsMeet(routeBoundsOf(terrain, waypoints), closed)) continue;
    const stop = firstStopInto(waypoints, world.get(e, PathFollow).index, cells);
    if (stop !== null) crossing.push({ e, stop });
  }
  for (const { e, stop } of crossing) haltBefore(world, terrain, e, stop);
}

function boundsMeet(a: NodeBounds, b: NodeBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** The first route stop whose node has closed, including a diagonal's actual midpoint. */
function firstStopInto(
  waypoints: readonly Waypoint[],
  from: number,
  cells: ReadonlySet<NodeId>,
): number | null {
  for (let at = from; at < waypoints.length; at++) {
    const stop = waypoints[at];
    if (stop !== undefined && cells.has(stop.node)) return at;
  }
  return null;
}

/** Whether `stop` is a diagonal's midpoint, the one kind of stop that sits off its node's centre. */
function isEdgeMidpoint(terrain: TerrainGraph, stop: Waypoint): boolean {
  const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
  return centre.x !== stop.x || centre.y !== stop.y;
}

/**
 * Cut the route before stop `stop` so the walker parks on the last free node centre, or turns back to the
 * node it left when the leg under way runs into the closed cells, then search again from where it stands.
 */
function haltBefore(world: World, terrain: TerrainGraph, e: Entity, stop: number): void {
  const route = world.mut(e, PathFollow);
  const path = world.mut(e, PathRoute);
  const waypoints = path.waypoints;
  let end = stop;
  // A diagonal's midpoint is the middle of an edge, not a node centre to park on, even the one it heads to.
  while (end - 1 >= route.index) {
    const previous = waypoints[end - 1];
    if (previous === undefined || !isEdgeMidpoint(terrain, previous)) break;
    end -= 1;
  }
  if (end > route.index) {
    path.waypoints = waypoints.slice(0, end);
  } else {
    const back = waypoints[route.index - 1];
    const beforeBack = waypoints[route.index - 2];
    if (back === undefined) {
      dropPath(world, e);
    } else {
      // Past a midpoint, the way back runs through it to the node the diagonal left.
      path.waypoints =
        beforeBack !== undefined && isEdgeMidpoint(terrain, back) ? [back, beforeBack] : [back];
      route.index = 0;
      route.legElapsed = 0;
      route.legStartedAt = undefined;
      route.legCost = 0;
      route.legPace = undefined;
      route.departureCharged = undefined;
    }
  }
  requestFromHere(world, terrain, e, true);
}

function requestFromHere(world: World, terrain: TerrainGraph, e: Entity, retainSafePrefix: boolean): void {
  world.remove(e, PathRequest);
  const goal = world.tryGet(e, MoveGoal)?.cell;
  if (goal === undefined) return;
  const p = world.get(e, Position);
  // A closing may have turned the live leg back. Search from the end of that safe prefix,
  // not a nearby bracket which could lie on or beyond the newly closed cells.
  const safeEnd =
    retainSafePrefix && world.has(e, PathFollow) ? world.get(e, PathRoute).waypoints.at(-1)?.node : undefined;
  world.add(e, PathRequest, {
    start: safeEnd ?? routeStartCell(terrain, p.x, p.y, settlerTraversal(world, e)),
    goal,
    failed: false,
    retainRoute: safeEnd === undefined ? undefined : true,
  });
}
