import { Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { sameCells, translatedCells } from './geometry.js';

/** A membership test over half-cell nodes. */
export interface NodeMembership {
  has(node: NodeId): boolean;
}

/** The cells standing walls and the posts of open gates block. */
export interface StandingWallCells {
  readonly walls: NodeMembership & Iterable<NodeId>;
}

/** A node set that counts its members, since the outer posts of a gate's run stand inside its body. */
class CountedNodes implements NodeMembership, Iterable<NodeId> {
  private readonly counts = new Map<NodeId, number>();

  has(node: NodeId): boolean {
    return this.counts.has(node);
  }

  [Symbol.iterator](): Iterator<NodeId> {
    return this.counts.keys();
  }

  add(node: NodeId): void {
    this.counts.set(node, (this.counts.get(node) ?? 0) + 1);
  }

  remove(node: NodeId): void {
    const count = this.counts.get(node) ?? 0;
    if (count <= 1) this.counts.delete(node);
    else this.counts.set(node, count - 1);
  }

  clear(): void {
    this.counts.clear();
  }
}

interface WallCapture {
  readonly walls: readonly NodeId[];
}

/** A wall's cells and gate state change only by re-adding its Palisade, and a wall never moves, so the
 *  two membership journals cover every input. */
const WALL_CELL_INPUTS = { membership: [Palisade, PalisadeBlocking], values: [] };

function captureWall(world: World, terrain: TerrainGraph, e: Entity): WallCapture | null {
  if (!world.has(e, PalisadeBlocking)) return null;
  const wall = world.tryGet(e, Palisade);
  const p = world.tryGet(e, Position);
  if (wall === undefined || p === undefined) return null;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const walls = translatedCells(terrain, wall.walk, hx, hy);
  return { walls };
}

class StandingWallIndex implements StandingWallCells {
  readonly walls = new CountedNodes();
  private readonly captures: JournaledCaptures<WallCapture>;

  constructor(
    world: World,
    readonly terrain: TerrainGraph,
  ) {
    this.captures = new JournaledCaptures<WallCapture>(
      world,
      WALL_CELL_INPUTS,
      () => world.query(PalisadeBlocking, Palisade, Position),
      {
        capture: (e) => captureWall(world, terrain, e),
        apply: (_e, captured) => {
          for (const cell of captured.walls) this.walls.add(cell);
        },
        withdraw: (_e, captured) => {
          for (const cell of captured.walls) this.walls.remove(cell);
        },
        clear: () => {
          this.walls.clear();
        },
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }
}

const standingWallIndexes = new WeakMap<World, StandingWallIndex>();

function deriveStandingWallCells(world: World, terrain: TerrainGraph): Set<NodeId> {
  const walls = new Set<NodeId>();
  for (const e of world.query(PalisadeBlocking, Palisade, Position)) {
    const captured = captureWall(world, terrain, e);
    for (const cell of captured?.walls ?? []) walls.add(cell);
  }
  return walls;
}

function verifyStandingWallCells(world: World, terrain: TerrainGraph): string[] {
  const held = standingWallIndexes.get(world);
  if (held === undefined || held.terrain !== terrain) return [];
  held.catchUp();
  const fresh = deriveStandingWallCells(world, terrain);
  if (sameCells(new Set(held.walls), fresh)) return [];
  return ['standingWallCells holds other cells than a re-derivation - a wall changed in place'];
}

/**
 * The live cells of the standing walls, caught up from the wall membership journals, so a placement or a
 * gate swap costs the walls that changed. Derived state, never hashed; membership reads only.
 */
export function standingWallCells(world: World, terrain: TerrainGraph): StandingWallCells {
  let index = standingWallIndexes.get(world);
  if (index?.terrain !== terrain) {
    index = new StandingWallIndex(world, terrain);
    standingWallIndexes.set(world, index);
    world.registerCacheVerifier('standingWallCells', () => verifyStandingWallCells(world, terrain));
    return index;
  }
  index.catchUp();
  return index;
}
