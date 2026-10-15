import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { entityNode } from '../spatial/nodes.js';
import { HERD_ELIGIBILITY_STORES, herdCandidates, herdEligible } from './herd-roster.js';

/** Coarse cell edge in half-cell nodes. Only the cost of a query depends on it, never its result. */
const HERD_CELL_NODES = 32;
/** How far an animal's movement node may sit from its position's node: a swimmer starts from one of the
 *  four lattice corners around its position. */
const MOVEMENT_NODE_SLACK = 1;

const idOf = (e: Entity): number => e;

/**
 * The herd-eligible animals bucketed by the coarse cell of their node, kept from the eligibility stores'
 * changes and node crossings, so a search within a herd radius reads the cells around it instead of
 * every herd. Each cell holds ascending ids; derived state, never hashed.
 */
class HerdGrid {
  private readonly cells = new Map<number, Entity[]>();
  private readonly cellOf = new Map<Entity, number>();
  private readonly columns: number;

  constructor(
    private readonly world: World,
    private readonly terrain: TerrainGraph,
    private readonly membership: ChangeFeed,
    private readonly moves: NodeMoveFeed,
  ) {
    this.columns = Math.ceil(terrain.width / HERD_CELL_NODES);
    this.rebuild();
  }

  update(): void {
    const resync = (e: Entity): void => this.resync(e);
    const membershipLost = this.membership.drain(resync);
    const movesLost = this.moves.drain(resync);
    if (membershipLost || movesLost) this.rebuild();
  }

  /** Hand `visit` every indexed animal whose node may lie within `reach` nodes of node (x, y) on both
   *  axes, ascending id within a cell; the cells come in no canonical order, so a caller picking a winner
   *  breaks ties itself. A hex distance of `reach` never exceeds `reach + 1` nodes on either axis. */
  forEachNear(x: number, y: number, reach: number, visit: (e: Entity) => void): void {
    const span = reach + 1 + MOVEMENT_NODE_SLACK;
    const rows = Math.ceil(this.terrain.height / HERD_CELL_NODES);
    const fromX = Math.max(0, Math.floor((x - span) / HERD_CELL_NODES));
    const toX = Math.min(this.columns - 1, Math.floor((x + span) / HERD_CELL_NODES));
    const fromY = Math.max(0, Math.floor((y - span) / HERD_CELL_NODES));
    const toY = Math.min(rows - 1, Math.floor((y + span) / HERD_CELL_NODES));
    for (let cy = fromY; cy <= toY; cy++) {
      for (let cx = fromX; cx <= toX; cx++) {
        const cell = this.cells.get(cy * this.columns + cx);
        if (cell !== undefined) for (const e of cell) visit(e);
      }
    }
  }

  private cellKey(e: Entity): number {
    const { x, y } = this.terrain.coordsOf(entityNode(this.world, this.terrain, e));
    return Math.floor(y / HERD_CELL_NODES) * this.columns + Math.floor(x / HERD_CELL_NODES);
  }

  private resync(e: Entity): void {
    const next = this.world.isAlive(e) && herdEligible(this.world, e) ? this.cellKey(e) : undefined;
    const held = this.cellOf.get(e);
    if (held === next) return;
    if (held !== undefined) {
      const cell = this.cells.get(held);
      if (cell !== undefined) {
        removeSortedById(cell, e, idOf);
        if (cell.length === 0) this.cells.delete(held);
      }
      this.cellOf.delete(e);
    }
    if (next === undefined) return;
    this.cellOf.set(e, next);
    const cell = this.cells.get(next);
    if (cell === undefined) this.cells.set(next, [e]);
    else insertSortedById(cell, e, idOf);
  }

  private rebuild(): void {
    this.membership.drain(() => {});
    this.moves.drain(() => {});
    this.cells.clear();
    this.cellOf.clear();
    for (const e of herdCandidates(this.world)) this.resync(e);
  }

  /** Compares the grid with a fresh scan of the herd stores. */
  verify(): string[] {
    this.update();
    let wrong = 0;
    let indexed = 0;
    for (const e of herdCandidates(this.world)) {
      if (!herdEligible(this.world, e)) continue;
      indexed++;
      if (this.cellOf.get(e) !== this.cellKey(e)) wrong++;
    }
    if (indexed !== this.cellOf.size) wrong++;
    return wrong === 0 ? [] : [`herdGrid: ${wrong} animals sit in the wrong cell`];
  }
}

const grids = new WeakMap<World, HerdGrid>();

/** `world`'s herd grid over its one `terrain`, brought up to date. */
export function herdGrid(world: World, terrain: TerrainGraph): HerdGrid {
  const held = grids.get(world);
  if (held !== undefined) {
    held.update();
    return held;
  }
  const grid = new HerdGrid(
    world,
    terrain,
    world.watchChanges(HERD_ELIGIBILITY_STORES, []),
    watchNodeMoves(world),
  );
  world.registerCacheVerifier('herdGrid', () => grids.get(world)?.verify() ?? []);
  grids.set(world, grid);
  return grid;
}

export type { HerdGrid };
