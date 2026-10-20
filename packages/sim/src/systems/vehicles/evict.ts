import { Position, Vehicle, VehicleDrive } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingDoorNodes, dynamicBlockOverlay, walkBlockedBodyOf } from '../footprint/index.js';
import { vehicleBlockedCells } from '../footprint/vehicle-blocked-cache.js';
import { hexDisc, vehicleAnchor, vehicleFootprintNodes } from '../footprint/vehicle-footprint.js';
import { settlersByNode } from '../movement/settler-nodes.js';
import { vehicleTraversal } from '../readviews/vehicles.js';
import { endDrive, startVehicleDrive, vehicleWalkBlocks } from './movement.js';
import { vehicleIndex } from './registry.js';

/** Project rule: placing or enlarging a house pushes overlapping vehicles and vehicles in newly sealed nooks onto free
 *  ground, just like settlers. The whole disc must fit; an enclosed vehicle with no landing stays put.
 *  Runs only when a footprint changes, never as a per-tick scan. */
export function evictVehiclesFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const body = walkBlockedBodyOf(world, ctx, terrain, building);
  if (body === null) return;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const doors = buildingDoorNodes(world, ctx, terrain);
  const evictees = vehicleIndex(world).all.filter((e) => {
    const cells = vehicleFootprintNodes(world, ctx.content, terrain, e);
    if (cells.some((node) => body.has(node))) return true;
    if (!cells.some((node) => terrain.neighbours(node).some((next) => body.has(next)))) return false;
    const anchor = vehicleAnchor(world, e);
    const type = contentIndex(ctx.content).vehicles.get(world.get(e, Vehicle).vehicleType);
    if (anchor === null || type === undefined || !terrain.inBounds(anchor.hx, anchor.hy)) return false;
    const from = terrain.nodeAt(anchor.hx, anchor.hy);
    if (doors.has(from)) return false;
    const traversal = vehicleTraversal(type);
    const walls = vehicleWalkBlocks(world, ctx, terrain, e, type);
    return terrain
      .neighbours(from)
      .every(
        (next) => !terrain.traversable(next, traversal) || !terrain.joined(from, next) || walls.has(next),
      );
  });
  if (evictees.length === 0) return;
  const settlers = settlersByNode(world);
  // Own copy: each landing changes occupancy before the next vehicle chooses, in ascending entity id.
  const occupied = new Map(vehicleBlockedCells(world, ctx, terrain));
  const cover = (nodes: readonly NodeId[], delta: number): void => {
    for (const node of nodes) occupied.set(node, (occupied.get(node) ?? 0) + delta);
  };
  for (const e of evictees) {
    const state = world.get(e, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    const anchor = vehicleAnchor(world, e);
    if (type === undefined || anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) continue;
    const traversal = vehicleTraversal(type);
    const previous = vehicleFootprintNodes(world, ctx.content, terrain, e);
    cover(previous, -1);
    const landing = ringSearch(
      terrain,
      terrain.nodeAt(anchor.hx, anchor.hy),
      STAND_SEARCH_CAP,
      {
        traverse: (node) => !blocked.has(node) || body.has(node),
        accept: (node) => {
          const centre = { hx: terrain.xOf(node), hy: terrain.yOf(node) };
          for (const { hx, hy } of hexDisc(centre, type.logicSize)) {
            if (!terrain.inBounds(hx, hy)) return false;
            const cell = terrain.nodeAt(hx, hy);
            if (
              !terrain.traversable(cell, traversal) ||
              terrain.componentOf(cell) !== terrain.componentOf(node) ||
              blocked.has(cell) ||
              doors.has(cell) ||
              (occupied.get(cell) ?? 0) > 0 ||
              settlers.at(hx, hy).length > 0
            )
              return false;
          }
          return terrain
            .neighbours(node)
            .some(
              (next) =>
                terrain.traversable(next, traversal) && terrain.joined(node, next) && !blocked.has(next),
            );
        },
      },
      traversal,
    );
    if (landing === null) {
      cover(previous, 1);
      continue;
    }
    const goal = world.tryGet(e, VehicleDrive)?.goal;
    const next = { hx: terrain.xOf(landing), hy: terrain.yOf(landing) };
    const at = positionOfNode(next.hx, next.hy);
    const pos = world.mut(e, Position);
    pos.x = at.x;
    pos.y = at.y;
    // Vehicle writes invalidate the footprint caches, even for a parked cart whose task stays the same.
    const live = world.mut(e, Vehicle);
    live.guard = next;
    live.moored = false;
    if (live.task !== 'docks') live.mooring = null;
    endDrive(world, e); // discard a held boarding route too: its start moved
    if (goal !== undefined) {
      startVehicleDrive(world, ctx, terrain, e, terrain.nodeAtClamped(goal.hx, goal.hy));
    }
    cover(vehicleFootprintNodes(world, ctx.content, terrain, e), 1);
  }
}
