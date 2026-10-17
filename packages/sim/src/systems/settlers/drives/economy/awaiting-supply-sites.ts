import type { ContentSet } from '@open-northland/data';
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
  if (held === undefined || held.terrain !== terrain || held.content !== ctx.content) {
    const created = new AwaitingSupplySites(
      world,
      ctx.content,
      terrain,
      kind === 'wall' ? Palisade : RoadSite,
    );
    byKind.set(kind, created);
    world.registerCacheVerifier(`soloSitesAwaitingSupply:${kind}`, () =>
      created.divergence().map((m) => `soloSitesAwaitingSupply ${kind}: ${m}`),
    );
    held = created;
  }
  return held.sync(inbound);
}

class AwaitingSupplySites {
  private readonly index: InteractionCellIndex;
  private readonly ctx: MapContext;
  /** Each filed site and the read that last found it awaiting supply. */
  private readonly filedAt = new Map<Entity, number>();
  private reads = 0;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
    private readonly component: typeof Palisade | typeof RoadSite,
  ) {
    this.ctx = { content, terrain };
    this.index = new InteractionCellIndex(world, this.ctx, terrain);
  }

  /** A mismatch per site the index files differently from a fresh index over the filed sites still unfinished.
   *  A site finished or destroyed since the last read stays filed until the next one drops it. */
  divergence(): string[] {
    const filed: Entity[] = [];
    const pending = new Set<Entity>();
    for (const site of this.filedAt.keys()) {
      if (this.unfinished(site)) filed.push(site);
      else pending.add(site);
    }
    filed.sort((a, b) => a - b);
    return this.index.divergence(
      new InteractionCellIndex(this.world, this.ctx, this.terrain, filed),
      pending,
    );
  }

  private unfinished(site: Entity): boolean {
    const { world } = this;
    return world.has(site, this.component) && world.has(site, UnderConstruction) && world.has(site, Position);
  }

  sync(inbound: ReadonlyMap<Entity, unknown>): InteractionCellIndex | null {
    const { index, filedAt } = this;
    const read = ++this.reads;
    let awaiting = 0;
    inbound.forEach((_goods, site) => {
      if (!this.unfinished(site)) return;
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
