import { CurrentAtomic, Settler } from '../../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../../ecs/world.js';

/**
 * Resource nodes some settler is working right now plus the picks made earlier in this planner pass: one
 * digger per node, so a crew spreads over a deposit's free nodes and surplus gatherers wait rather than
 * crowd a colleague's swing. Claims span all owners, since two settlers cannot share one swing whoever
 * commands them. Source basis: authored.
 */
export type HarvestClaims = Set<Entity>;

/** The node `e`'s live harvest atomic works, if any. */
function harvestedNode(world: World, e: Entity): Entity | undefined {
  if (!world.has(e, Settler)) return undefined;
  const effect = world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'harvest' || effect?.kind === 'harvestFollowThrough' ? effect.resource : undefined;
}

/** The nodes live harvest atomics work, with how many settlers work each, kept per world from a feed of
 *  the settlers' atomics. */
class LiveHarvests {
  private readonly nodeOf = new Map<Entity, Entity>();
  private readonly workers = new Map<Entity, number>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([Settler, CurrentAtomic], [CurrentAtomic]);
    this.rebuild();
  }

  /** The worked nodes as of now, as a fresh set the pass may add its picks to. */
  claims(): HarvestClaims {
    this.catchUp();
    return new Set(this.workers.keys());
  }

  private catchUp(): void {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
  }

  private refresh(e: Entity): void {
    const node = harvestedNode(this.world, e);
    const prior = this.nodeOf.get(e);
    if (node === prior) return;
    if (prior !== undefined) {
      const left = (this.workers.get(prior) ?? 0) - 1;
      if (left > 0) this.workers.set(prior, left);
      else this.workers.delete(prior);
    }
    if (node === undefined) this.nodeOf.delete(e);
    else {
      this.nodeOf.set(e, node);
      this.workers.set(node, (this.workers.get(node) ?? 0) + 1);
    }
  }

  private rebuild(): void {
    this.nodeOf.clear();
    this.workers.clear();
    for (const e of this.world.query(Settler, CurrentAtomic)) this.refresh(e);
  }

  verify(): string[] {
    this.catchUp();
    const fresh = new Set<Entity>();
    for (const e of this.world.query(Settler, CurrentAtomic)) {
      const node = harvestedNode(this.world, e);
      if (node !== undefined) fresh.add(node);
    }
    const held = [...this.workers.keys()];
    return fresh.size === held.length && held.every((node) => fresh.has(node))
      ? []
      : ['harvestClaims live harvests diverge from a fresh scan'];
  }
}

const liveHarvests = new WeakMap<World, LiveHarvests>();

/** Seed the tick's claims from every live harvest atomic. Membership-only, so no canonical order is needed. */
export function collectHarvestClaims(world: World): HarvestClaims {
  let held = liveHarvests.get(world);
  if (held === undefined) {
    const created = new LiveHarvests(world);
    world.registerCacheVerifier('harvestClaims', () => created.verify());
    liveHarvests.set(world, created);
    held = created;
  }
  return held.claims();
}
