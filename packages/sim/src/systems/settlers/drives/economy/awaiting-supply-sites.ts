import { Palisade, Position, RoadSite, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { MapContext } from '../../../context.js';
import { InteractionCellIndex } from '../../targets/index.js';

/** The single-builder site kinds a builder may stage at while their supply walks in. */
export type SoloSiteKind = 'wall' | 'road';

/**
 * The unfinished `kind` sites with supply inbound, as a builder's staging index kept across reads: each
 * read files the sites that gained inbound since the last one and drops those that lost it, so the
 * index and its grids are not rebuilt per plan. A site never moves and an entity id is never reused, so a
 * site stays where it was filed. Null when no such site has supply inbound. Derived read state, never
 * hashed.
 */
export function soloSitesAwaitingSupply(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  inbound: ReadonlyMap<Entity, unknown>,
  kind: SoloSiteKind,
): InteractionCellIndex | null {
  let byKind = heldByWorld.get(world);
  if (byKind === undefined) {
    byKind = new Map();
    heldByWorld.set(world, byKind);
  }
  let held = byKind.get(kind);
  if (held === undefined || held.terrain !== terrain) {
    held = new AwaitingSupplySites(world, ctx, terrain);
    byKind.set(kind, held);
  }
  return held.sync(inbound, kind === 'wall' ? Palisade : RoadSite);
}

class AwaitingSupplySites {
  private readonly index: InteractionCellIndex;
  /** Each filed site and the read that last found it awaiting supply. */
  private readonly filedAt = new Map<Entity, number>();
  private reads = 0;

  constructor(
    private readonly world: World,
    ctx: MapContext,
    readonly terrain: TerrainGraph,
  ) {
    this.index = new InteractionCellIndex(world, ctx, terrain);
  }

  sync(
    inbound: ReadonlyMap<Entity, unknown>,
    component: typeof Palisade | typeof RoadSite,
  ): InteractionCellIndex | null {
    const { world, index, filedAt } = this;
    const read = ++this.reads;
    let awaiting = 0;
    inbound.forEach((_goods, site) => {
      if (!world.has(site, component) || !world.has(site, UnderConstruction) || !world.has(site, Position)) {
        return;
      }
      if (!filedAt.has(site)) index.add(site);
      filedAt.set(site, read);
      awaiting++;
    });
    filedAt.forEach((at, site) => {
      if (at === read) return;
      index.remove(site);
      filedAt.delete(site);
    });
    return awaiting === 0 ? null : index;
  }
}

const heldByWorld = new WeakMap<World, Map<SoloSiteKind, AwaitingSupplySites>>();
