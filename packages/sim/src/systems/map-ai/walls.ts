import { footprintCellDx } from '@open-northland/data';
import {
  MAP_AI_WALL_LIST_LIMIT,
  type MapAiWallRecord,
  ownerOf,
  Palisade,
  Position,
  playerPlacementTribes,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { nearestRaiderWithin, type Raider } from '../ai-shared/military/defence/threat.js';
import { ownedSettlers } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { lineGroundOpen } from '../footprint/line-ground.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { palisadeType } from '../palisades/index.js';
import { entityNode } from '../spatial/nodes.js';

/** How close an enemy fighter keeps a wall from going up, and how close one of the seat's people must
 *  stand to it, in map points. Original behavior. */
export const WALL_REBUILD_NEAR_POINTS = 40;
/** Wall sites the handler raises a pass at most. Original behavior. */
export const WALL_REBUILD_PASS_LIMIT = 10;

/**
 * The seat's walls and gates as its first handler turn finds them, nearest `centre` first, ties by
 * entity. Original behavior for the walls, which the original takes out ring by ring from the centre;
 * remembering the gates is a project rule, the original only mends them.
 */
export function wallList(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  centre: { readonly hx: number; readonly hy: number } | null,
): MapAiWallRecord[] {
  const found: { record: MapAiWallRecord; distance: number; entity: Entity }[] = [];
  for (const e of world.query(Palisade, Position)) {
    if (ownerOf(world, e) !== seat) continue;
    const wall = world.get(e, Palisade);
    const at = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    const gfxIndex = wall.gate?.open === true ? wall.gate.counterpartGfxIndex : wall.gfxIndex;
    const standing = groundLoad(world, ctx, terrain, gfxIndex, hx, hy);
    if (standing === null) continue;
    // The wall's own body stamp leaves with it; what else stood there may stand there again.
    const ground = standing - (palisadeType(terrain, gfxIndex)?.walk.length ?? 0);
    const distance = centre === null ? 0 : hexDistanceBetween(hx, hy, centre.hx, centre.hy);
    found.push({ record: { gfxIndex, tribe: wall.tribe, hx, hy, ground }, distance, entity: e });
  }
  found.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
  return found.slice(0, MAP_AI_WALL_LIST_LIMIT).map((f) => f.record);
}

/**
 * A wall site for each remembered wall or gate whose anchor no wall covers and whose ground holds no more
 * than it held beside the wall on the first turn, at most {@link WALL_REBUILD_PASS_LIMIT} a pass, when no
 * enemy fighter and one of the seat's people stands within {@link WALL_REBUILD_NEAR_POINTS}. The site
 * goes where the map stood the wall, over the deposit or the neighbouring segment the map stood it on;
 * a building or wall raised there since keeps it out. Original behavior for the walls; a gate is raised
 * again as a shut gate site (project rule).
 */
export function wallRebuildOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  walls: readonly MapAiWallRecord[],
  raiders: readonly Raider[],
): PlayerCommand[] {
  if (walls.length === 0) return [];
  // A person aboard a vehicle stands nowhere until set down.
  const people = ownedSettlers(world, seat)
    .filter((e) => world.has(e, Position))
    .map((e) => terrain.coordsOf(entityNode(world, terrain, e)));
  if (people.length === 0) return [];
  const tribes = playerPlacementTribes(world, seat) ?? [];
  const { palisadeBody } = placementBlockerGrid(world, ctx.content, terrain);
  const commands: PlayerCommand[] = [];
  for (const wall of walls) {
    // A wall of a nation the seat no longer places would be refused, and hold a place in the pass.
    if (!tribes.includes(wall.tribe)) continue;
    if (!terrain.inBounds(wall.hx, wall.hy) || (palisadeBody[wall.hy * terrain.width + wall.hx] ?? 0) > 0)
      continue;
    const load = groundLoad(world, ctx, terrain, wall.gfxIndex, wall.hx, wall.hy);
    if (load === null || load > wall.ground) continue;
    if (nearestRaiderWithin(raiders, wall.hx, wall.hy, WALL_REBUILD_NEAR_POINTS, null) !== null) continue;
    if (!people.some((at) => hexDistanceBetween(at.x, at.y, wall.hx, wall.hy) <= WALL_REBUILD_NEAR_POINTS))
      continue;
    commands.push({
      kind: 'placePalisade',
      gfxIndex: wall.gfxIndex,
      x: wall.hx,
      y: wall.hy,
      tribe: wall.tribe,
      owner: seat,
      underConstruction: true,
      force: true,
    });
    if (commands.length === WALL_REBUILD_PASS_LIMIT) break;
  }
  return commands;
}

/** The blocker and wall stamps on the body of `gfxIndex` anchored at (hx, hy), or null when the row is no
 *  wall or a body node is off the map, unwalkable or holds a solid resource. */
function groundLoad(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  gfxIndex: number,
  hx: number,
  hy: number,
): number | null {
  const body = palisadeType(terrain, gfxIndex)?.walk;
  if (body === undefined) return null;
  const { obstacle, palisadeBody } = placementBlockerGrid(world, ctx.content, terrain);
  let load = 0;
  for (const c of body) {
    const x = hx + footprintCellDx(hy, c);
    const y = hy + c.dy;
    if (!terrain.inBounds(x, y) || !terrain.isWalkable(terrain.nodeAt(x, y))) return null;
    // A tree of any age or another solid resource standing on a node is worked away first, as for any
    // wall, even where it stamps no blocker.
    if (!lineGroundOpen(world, ctx.content, x, y)) return null;
    const slot = y * terrain.width + x;
    load += (obstacle[slot] ?? 0) + (palisadeBody[slot] ?? 0);
  }
  return load;
}
