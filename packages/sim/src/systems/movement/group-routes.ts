import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import {
  type CorridorEntry,
  corridorGap,
  joinCorridor,
  type SearchStats,
} from '../../nav/pathfinding/index.js';
import { type NodeId, nodeLatticeDistance, type TerrainGraph } from '../../nav/terrain/index.js';
import { GroupLanes } from './group-lanes.js';

/**
 * How far (Manhattan half-cell nodes) a group member may start and end from the route it borrows.
 * Authored: wide enough that a hundred men, spread over the player's formation or an AI assault ring,
 * reach one route from its far corner.
 */
export const GROUP_AREA_RADIUS_NODES = 48;

/**
 * The shortest route, in nodes, another group member may borrow. Below it a member's own search costs
 * about what the hops on and off the corridor would, so it routes alone. Authored.
 */
export const SHARED_ROUTE_MIN_NODES = 96;

/**
 * How far (Manhattan half-cell nodes) a member the short joins could not serve may stand from the nearest
 * shared route, and its goal from that route, and still ride it instead of its own search the length of
 * the march: an army spread over a settlement converges on its leaders' road rather than each loose band
 * routing alone, and a wide formation's far slots leave that road where it passes nearest. Authored:
 * covers a seat's spread-out army and a thousand-man formation.
 */
const BOARDING_HOP_NODES = 256;

/** The settle cap of each search onto or off that route. Authored: a fraction of a cross-map search. */
const BOARDING_LEG_MAX_EXPLORED = 8192;

const BOARDING: CorridorEntry = { hopNodes: BOARDING_HOP_NODES, legMaxExplored: BOARDING_LEG_MAX_EXPLORED };

interface GroupRoute {
  readonly blocked: BlockOverlay;
  readonly path: readonly NodeId[];
  readonly meanWeight: Fixed;
}

/**
 * One tick's group-move routes. The lowest-id member routes in full. Others prefer independently
 * checked straight lanes, then parallel obstacle detours, then short joins to that corridor, and finally
 * one wide ride on the shared route nearest them, with longer legs on and off it. A wide ride is offered
 * like a searched route, so the members whose slots lie near its end join it with short legs, and a
 * member no route serves searches alone and offers its route: full searches and wide rides count the
 * army's separate bands and the formation's far corners, not its members. Every member routes in the
 * same tick. A group has no id of its own: compatible terrain resistance and the walk overlay are what
 * permit sharing.
 */
export class GroupRoutes {
  private readonly routes: GroupRoute[] = [];
  private readonly terrain: TerrainGraph;
  private readonly lanes: GroupLanes;
  private version = -1;
  constructor(terrain: TerrainGraph) {
    this.terrain = terrain;
    this.lanes = new GroupLanes(terrain);
  }

  /** Footprint membership can change during a drain. Never reuse a lane checked before that change. */
  refresh(version: number): void {
    if (version === this.version) return;
    this.version = version;
    this.routes.length = 0;
    this.lanes.reset();
  }

  /** A clear lane or a route borrowing a nearby detour, or null to search independently. */
  borrow(blocked: BlockOverlay, start: NodeId, goal: NodeId, stats: SearchStats): NodeId[] | null {
    for (const route of this.routes) {
      if (route.blocked !== blocked) continue;
      const direct = this.lanes.direct(blocked, start, goal, route.meanWeight);
      if (direct !== null) return direct;
      const translated = this.lanes.translated(
        blocked,
        route.path,
        start,
        goal,
        route.meanWeight,
        GROUP_AREA_RADIUS_NODES,
      );
      if (translated !== null) return translated;
      const joined = joinCorridor(
        this.terrain,
        route.path,
        start,
        goal,
        blocked,
        stats,
        GROUP_AREA_RADIUS_NODES,
      );
      if (joined !== null) return this.lanes.departEarly(blocked, joined, goal, route.meanWeight);
    }
    const nearest = this.nearestRoute(blocked, start);
    if (nearest === undefined) return null;
    const boarded = joinCorridor(
      this.terrain,
      nearest.path,
      start,
      goal,
      blocked,
      stats,
      GROUP_AREA_RADIUS_NODES,
      'land',
      BOARDING,
      BOARDING,
    );
    if (boarded === null) return null;
    this.offer(blocked, boarded);
    return this.lanes.departEarly(blocked, boarded, goal, nearest.meanWeight);
  }

  /** The route under `blocked` with a node nearest `start`, the first offered on a tie. A failed wide ride
   *  costs up to two capped searches, so a member tries only this one before searching alone. */
  private nearestRoute(blocked: BlockOverlay, start: NodeId): GroupRoute | undefined {
    let nearest: GroupRoute | undefined;
    let nearestGap = BOARDING_HOP_NODES + 1;
    for (const route of this.routes) {
      if (route.blocked !== blocked) continue;
      const gap = corridorGap(this.terrain, route.path, start);
      if (gap < nearestGap) {
        nearest = route;
        nearestGap = gap;
      }
    }
    return nearest;
  }

  /** Offer a member's own full route to the rest of its group. */
  offer(blocked: BlockOverlay, path: readonly NodeId[]): void {
    if (path.length < SHARED_ROUTE_MIN_NODES) return;
    let length = ZERO,
      cost = ZERO;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1],
        to = path[i];
      if (from === undefined || to === undefined) continue;
      const distance = nodeLatticeDistance(this.terrain, from, to);
      length = fx.add(length, distance);
      cost = fx.add(cost, fx.mul(distance, this.terrain.routeWeightAt(to, 'land')));
    }
    const meanWeight = length === 0 ? ZERO : meanResistance(cost, length);
    this.routes.push({ blocked, path, meanWeight });
  }
}

/** Compute cost/length without scaling the entire long-route cost by ONE. That intermediate can
 * exceed the exact-integer range even though each step, the total and the resulting mean are safe.
 * The 16 fractional bits use only doubled remainders below twice the route's geometric length. */
function meanResistance(cost: Fixed, length: Fixed): Fixed {
  let whole = Math.trunc(cost / length);
  while (whole * length > cost) whole--;
  while ((whole + 1) * length <= cost) whole++;
  let remainder = cost - whole * length;
  let fraction = 0;
  for (let bit = 0; bit < 16; bit++) {
    remainder *= 2;
    fraction *= 2;
    if (remainder >= length) {
      remainder -= length;
      fraction++;
    }
  }
  return fx.add(fx.fromInt(whole), fx.mulInt(ULP, fraction));
}
