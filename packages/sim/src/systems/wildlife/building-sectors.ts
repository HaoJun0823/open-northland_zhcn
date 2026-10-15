import { Building, Owner, Position } from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { entityNode } from '../spatial/nodes.js';

/** Original behavior: the map is tallied in square sectors 20 map points on a side. */
export const HABITAT_SECTOR_SIZE = 20;

interface Placed {
  readonly sector: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The players' buildings per map sector, kept across ticks from the building stores' changes: a count per
 * sector and the buildings standing in it. Wild animals read it as the settled ground they keep away from.
 * A building counts when some player owns it; a neutral ruin does not.
 */
export class BuildingSectors {
  readonly columns: number;
  readonly rows: number;
  private readonly counts: Int32Array;
  private readonly placed = new Map<Entity, Placed>();
  private readonly bySector = new Map<number, Entity[]>();

  constructor(
    private readonly world: World,
    readonly terrain: TerrainGraph,
    readonly feed: ChangeFeed,
  ) {
    this.columns = Math.ceil(terrain.width / HABITAT_SECTOR_SIZE);
    this.rows = Math.ceil(terrain.height / HABITAT_SECTOR_SIZE);
    this.counts = new Int32Array(this.columns * this.rows);
    this.rebuild();
  }

  update(): void {
    if (this.feed.drain((e) => this.resync(e))) this.rebuild();
  }

  /** The players' buildings in sector `(sx, sy)`, 0 off the grid. */
  countAt(sx: number, sy: number): number {
    if (sx < 0 || sy < 0 || sx >= this.columns || sy >= this.rows) return 0;
    return this.counts[sy * this.columns + sx] ?? 0;
  }

  /** Whether a player's building stands within `radius` map points of `(x, y)`. */
  anyWithin(x: number, y: number, radius: number): boolean {
    const first = (v: number): number => Math.max(0, Math.floor((v - radius) / HABITAT_SECTOR_SIZE));
    const lastX = Math.min(this.columns - 1, Math.floor((x + radius) / HABITAT_SECTOR_SIZE));
    const lastY = Math.min(this.rows - 1, Math.floor((y + radius) / HABITAT_SECTOR_SIZE));
    for (let sy = first(y); sy <= lastY; sy++) {
      for (let sx = first(x); sx <= lastX; sx++) {
        for (const b of this.bySector.get(sy * this.columns + sx) ?? []) {
          const at = this.placed.get(b);
          if (at !== undefined && hexDistanceBetween(at.x, at.y, x, y) <= radius) return true;
        }
      }
    }
    return false;
  }

  private rebuild(): void {
    this.feed.drain(() => {});
    this.counts.fill(0);
    this.placed.clear();
    this.bySector.clear();
    for (const e of this.world.canonicalQuery(Building, Position, Owner)) this.resync(e);
  }

  private resync(e: Entity): void {
    const old = this.placed.get(e);
    if (old !== undefined) {
      this.placed.delete(e);
      this.counts[old.sector] = (this.counts[old.sector] ?? 0) - 1;
      const list = this.bySector.get(old.sector);
      const i = list?.indexOf(e) ?? -1;
      if (list !== undefined && i >= 0) list.splice(i, 1);
    }
    const world = this.world;
    if (!world.isAlive(e) || !world.has(e, Building) || !world.has(e, Position) || !world.has(e, Owner))
      return;
    const node = entityNode(world, this.terrain, e);
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    const sector = Math.floor(y / HABITAT_SECTOR_SIZE) * this.columns + Math.floor(x / HABITAT_SECTOR_SIZE);
    this.placed.set(e, { sector, x, y });
    this.counts[sector] = (this.counts[sector] ?? 0) + 1;
    const list = this.bySector.get(sector);
    if (list === undefined) this.bySector.set(sector, [e]);
    else list.push(e);
  }
}

const indexes = new WeakMap<World, BuildingSectors>();

/** `world`'s building sectors, brought up to date. Valid until the next building change. */
export function buildingSectors(world: World, terrain: TerrainGraph): BuildingSectors {
  const held = indexes.get(world);
  if (held !== undefined && held.terrain === terrain) {
    held.update();
    return held;
  }
  const sectors = new BuildingSectors(
    world,
    terrain,
    // Buildings never move, so only membership and owner writes are watched: a Position value feed would
    // record every walker on every step.
    held?.feed ?? world.watchChanges([Building, Position, Owner], [Owner]),
  );
  indexes.set(world, sectors);
  return sectors;
}
