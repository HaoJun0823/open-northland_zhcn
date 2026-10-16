import type { ContentSet } from '@open-northland/data';
import {
  Building,
  GOODS_SEARCH_RANGE_NODES,
  Owner,
  Position,
  signpostNavigationEnabled,
} from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { TileBuckets } from '../../inspect/tile-buckets.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import { type NodeBox, type SpatialGate, unionNodeBoxes } from '../../nav/node-circle.js';
import { type ReachArea, reachBox, reachContains } from '../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { interactionNode } from '../footprint/interaction.js';
import { GroupCoverage } from './group-coverage.js';
import { type SignpostSite, signpostNetwork, signpostNetworkRevision } from './network.js';
import {
  dropFallenPostReaches,
  GOODS_SEARCH_SPAN,
  postTerrainReach,
  signpostMask,
  type TerrainReach,
  terrainReach,
} from './terrain-reach.js';

/** What a cache's answers depend on beyond the terrain: the walk-block mask version, the mirrored road
 *  revision, the signpost network revision and the door revision. */
interface ReachVersions {
  readonly mask: number;
  readonly roads: number;
  readonly network: number;
  readonly doors: number;
}

interface ReachCache {
  readonly terrain: TerrainGraph;
  readonly versions: ReachVersions;
  /** Moves whenever the mask or road version does: the reading group coverages re-check posts against. */
  readonly epoch: number;
  readonly spots: Map<number, TerrainReach>;
  readonly network: NetworkReach;
  readonly limits: Map<number, GoodsSearchLimit>;
  readonly views: Map<number, SignpostReachView>;
}
const caches = new WeakMap<World, ReachCache>();

/** What derives from one signpost network revision, kept through mask, road and door changes. */
interface NetworkReach {
  readonly revision: number;
  readonly sites: TileBuckets<SignpostSite & { player: number }>;
  /** Each group's posts by group label, an entity id and so unique across players. */
  readonly groupPosts: ReadonlyMap<number, readonly SignpostSite[]>;
  readonly coverages: Map<number, GroupCoverage>;
}

/** Local searches held, about (2 * range - 1)^2 bytes each: enough that a settler re-planning from the
 *  spot it stands on finds its search again a scan beat later. */
const SPOT_REACH_CAP = 1024;
/** Limits held per reach key. A limit is a few references over a held local search and shared group
 *  coverages, so this bounds the local searches limits keep alive past {@link SPOT_REACH_CAP}. */
const LIMIT_CAP = 1024;

interface Doors {
  readonly feed: ChangeFeed;
  readonly entries: Map<Entity, { player: number; hx: number; hy: number }>;
  revision: number;
}
const doorCaches = new WeakMap<World, Doors>();
function doorsOf(world: World, content: ContentSet, terrain: TerrainGraph): Doors {
  let held = doorCaches.get(world);
  if (held === undefined) {
    held = {
      feed: world.watchChanges([Building, Position, Owner], [Building, Position, Owner]),
      entries: new Map(),
      revision: 0,
    };
    held.feed.lose();
    doorCaches.set(world, held);
  }
  const state = held;
  const update = (id: Entity): void => {
    const old = state.entries.get(id);
    if (!world.has(id, Building)) {
      if (state.entries.delete(id)) state.revision++;
      return;
    }
    const player = world.tryGet(id, Owner)?.player;
    const door = interactionNode(world, { content, terrain }, id);
    if (player === undefined || door === null) {
      if (state.entries.delete(id)) state.revision++;
    } else if (old?.player !== player || old.hx !== door.x || old.hy !== door.y) {
      state.entries.set(id, { player, hx: door.x, hy: door.y });
      state.revision++;
    }
  };
  if (state.feed.drain(update)) {
    const ids = new Set([...state.entries.keys(), ...world.query(Building, Position, Owner)]);
    for (const id of ids) update(id);
  }
  return state;
}

export function signpostReachKey(world: World, content: ContentSet, terrain: TerrainGraph): string {
  return reachKeyOf(reachVersions(world, content, terrain));
}

function reachKeyOf(v: ReachVersions): string {
  return `${v.mask}:${v.roads}:${v.network}:${v.doors}`;
}

/** Whether `v` still names the world's current versions, read without building a key. */
function versionsHold(v: ReachVersions, world: World, content: ContentSet, terrain: TerrainGraph): boolean {
  return (
    v.mask === signpostMask(world, content, terrain).version &&
    v.roads === terrain.mirroredRoadRevision &&
    v.network === signpostNetworkRevision(world) &&
    v.doors === doorsOf(world, content, terrain).revision
  );
}

function reachVersions(world: World, content: ContentSet, terrain: TerrainGraph): ReachVersions {
  return {
    mask: signpostMask(world, content, terrain).version,
    roads: terrain.mirroredRoadRevision,
    network: signpostNetworkRevision(world),
    doors: doorsOf(world, content, terrain).revision,
  };
}

function cacheOf(world: World, content: ContentSet, terrain: TerrainGraph): ReachCache {
  let cache = caches.get(world);
  if (
    cache === undefined ||
    cache.terrain !== terrain ||
    !versionsHold(cache.versions, world, content, terrain)
  ) {
    const versions = reachVersions(world, content, terrain);
    const held = cache?.terrain === terrain ? cache : undefined;
    let network = held?.network;
    if (network?.revision !== versions.network) {
      network = networkReach(world, versions.network, network);
      dropFallenPostReaches(world);
    }
    const reread =
      held !== undefined && (held.versions.mask !== versions.mask || held.versions.roads !== versions.roads);
    cache = {
      terrain,
      versions,
      epoch: held === undefined ? 0 : held.epoch + (reread ? 1 : 0),
      spots: held?.spots ?? new Map(),
      network,
      views: new Map(),
      limits: new Map(),
    };
    caches.set(world, cache);
  }
  return cache;
}

/** The network's site buckets and groups, taking over each coverage of `prior` whose group kept the
 *  same posts on the same nodes, since its counts derive from those posts' searches alone. */
function networkReach(world: World, revision: number, prior: NetworkReach | undefined): NetworkReach {
  const sites = new TileBuckets<SignpostSite & { player: number }>();
  const groupPosts = new Map<number, SignpostSite[]>();
  for (const [player, posts] of signpostNetwork(world)) {
    for (const p of posts) {
      sites.set(p.entity, { ...p, player }, p.hx / 2, p.hy / 2);
      let members = groupPosts.get(p.group);
      if (members === undefined) {
        members = [];
        groupPosts.set(p.group, members);
      }
      members.push(p);
    }
  }
  const coverages = new Map<number, GroupCoverage>();
  for (const [group, coverage] of prior?.coverages ?? []) {
    const posts = groupPosts.get(group);
    if (posts !== undefined && samePosts(coverage.posts, posts)) coverages.set(group, coverage);
  }
  return { revision, sites, groupPosts, coverages };
}

function samePosts(a: readonly SignpostSite[], b: readonly SignpostSite[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as SignpostSite;
    const q = b[i] as SignpostSite;
    if (p.entity !== q.entity || p.hx !== q.hx || p.hy !== q.hy) return false;
  }
  return true;
}

export function goodsReachAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
): ReachArea {
  const cache = cacheOf(world, content, terrain);
  const key = spotKey(0, hx, hy);
  const held = key === null ? undefined : cache.spots.get(key);
  const found = terrainReach(world, content, terrain, hx, hy, GOODS_SEARCH_SPAN, held);
  if (key === null) return found.area;
  // Re-inserted on every read, so the map runs least recently asked first and eviction drops the oldest.
  if (held !== undefined) cache.spots.delete(key);
  else if (cache.spots.size >= SPOT_REACH_CAP) {
    for (const oldest of cache.spots.keys()) {
      cache.spots.delete(oldest);
      break;
    }
  }
  cache.spots.set(key, found);
  return found.area;
}

function postReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  id: Entity,
  hx: number,
  hy: number,
): ReachArea {
  return postTerrainReach(world, content, terrain, id, hx, hy, GOODS_SEARCH_SPAN).area;
}

/** Goods are discovered locally or through the connected guides reached by the same local search. */
export function goodsSearchLimitAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number | undefined,
  hx: number,
  hy: number,
): GoodsSearchLimit | null {
  if (!signpostNavigationEnabled(world) || player === undefined) return null;
  const cache = cacheOf(world, content, terrain);
  const key = spotKey(player, hx, hy);
  if (key === null) return new GoodsSearchLimit(world, content, terrain, cache, player, hx, hy);
  return heldLatest(cache.limits, key, LIMIT_CAP, () => {
    return new GoodsSearchLimit(world, content, terrain, cache, player, hx, hy);
  });
}

/** `map`'s entry for `key`, else `make`'s, re-inserted on every read so the map runs least recently asked
 *  first, and the oldest dropped to keep at most `cap`. */
function heldLatest<T>(map: Map<number, T>, key: number, cap: number, make: () => T): T {
  const held = map.get(key);
  if (held !== undefined) {
    map.delete(key);
    map.set(key, held);
    return held;
  }
  if (map.size >= cap) {
    for (const oldest of map.keys()) {
      map.delete(oldest);
      break;
    }
  }
  const made = make();
  map.set(key, made);
  return made;
}

/**
 * {@link goodsSearchLimitAt} without its terrain flood: a node passes inside hex range of the spot or under
 * a group caught by that range. The flood is the one cost that grows with distinct spots, so a read that
 * asks for thousands of spots per click takes this half and over-lists what lies across water or walls
 * inside the range. Null where {@link goodsSearchLimitAt} is.
 */
export function goodsSearchCatchAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number | undefined,
  hx: number,
  hy: number,
): SpatialGate | null {
  const limit = goodsSearchLimitAt(world, content, terrain, player, hx, hy);
  if (limit === null) return null;
  return { bounds: limit.bounds, allowsNode: (node) => limit.catchesNode(node) };
}

/** Exclusive bound of each field {@link spotKey} packs. */
const SPOT_KEY_SPAN = 1 << 16;

/** A player's spot as one number, or null outside the packable span, which is answered uncached. */
function spotKey(player: number, hx: number, hy: number): number | null {
  if (player < 0 || player >= SPOT_KEY_SPAN || hx < 0 || hy < 0 || hx >= SPOT_KEY_SPAN || hy >= SPOT_KEY_SPAN)
    return null;
  return (player * SPOT_KEY_SPAN + hy) * SPOT_KEY_SPAN + hx;
}

/**
 * A spot's goods search: its own terrain search plus the signpost groups that search reaches. A caught
 * post lies strictly inside the hex range, so a node outside that range and outside every group with a
 * post inside it passes under no search result. The own search floods only for a node inside the range
 * that no caught group covers.
 *
 * Whether a group is caught is read off its posts' held floods: the own flood marks post `p` exactly when
 * `p`'s flood marks the spot, while both nodes are unblocked with nonzero resistance. A flood marks a
 * node once it enters a neighbour of it under budget, and a path's cost sums the resistances of the nodes
 * it enters after its start, so the reversed path, ending next to the other end, costs the same. A spot
 * failing that test resolves through its own flood.
 *
 * A limit answers only under the reach key it was built under: asked after that key moved, it throws
 * rather than mix two worlds, since a client restored from a snapshot would resolve it differently.
 */
class GoodsSearchLimit implements SpatialGate {
  readonly bounds: NodeBox;
  /** Every group with a post inside the hex range: the ones the search may catch. */
  private readonly nearby: readonly GroupCoverage[];
  /** Per {@link nearby} group, its posts inside the hex range. */
  private readonly nearbyPosts: readonly (readonly SignpostSite[])[];
  /** Per {@link nearby} group, whether the own search catches it, once asked. */
  private readonly caught: Uint8Array;
  private local: ReachArea | undefined;
  /** The reach versions and epoch the limit was built under, and the world mutation version it was last
   *  confirmed at. */
  private readonly versions: ReachVersions;
  private readonly epoch: number;
  private confirmedAt: number;

  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
    private readonly terrain: TerrainGraph,
    cache: ReachCache,
    player: number,
    private readonly hx: number,
    private readonly hy: number,
  ) {
    this.versions = cache.versions;
    this.epoch = cache.epoch;
    this.confirmedAt = world.mutationVersion;
    const range = GOODS_SEARCH_RANGE_NODES;
    const own = reachBox(terrain, hx, hy, range);
    const groups = new Map<number, SignpostSite[]>();
    for (const p of postsWithin(cache, own)) {
      if (p.player !== player || hexDistanceBetween(hx, hy, p.hx, p.hy) >= range) continue;
      const members = groups.get(p.group);
      if (members === undefined) groups.set(p.group, [p]);
      else members.push(p);
    }
    this.nearby = [...groups.keys()].map((group) => coverageOf(world, content, terrain, cache, group));
    this.nearbyPosts = [...groups.values()];
    this.caught = new Uint8Array(this.nearby.length);
    this.bounds = unionNodeBoxes([own, ...this.nearby.map((g) => g.bounds)]);
  }

  allowsNode(node: NodeId): boolean {
    if (!this.catchesNode(node)) return false;
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    if (this.local !== undefined && reachContains(this.local, x, y)) return true;
    for (let i = 0; i < this.nearby.length; i++)
      if ((this.nearby[i] as GroupCoverage).covers(x, y, this.epoch) && this.catches(i)) return true;
    // The own flood marks nothing outside the hex range.
    if (hexDistanceBetween(this.hx, this.hy, x, y) >= GOODS_SEARCH_RANGE_NODES) return false;
    return reachContains(this.ownSearch(), x, y);
  }

  /** The flood-free half of {@link allowsNode}: inside the hex range or under a caught group. */
  catchesNode(node: NodeId): boolean {
    this.confirmKey();
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    return hexDistanceBetween(this.hx, this.hy, x, y) < GOODS_SEARCH_RANGE_NODES || this.nearbyAllows(node);
  }

  private nearbyAllows(node: NodeId): boolean {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    for (let i = 0; i < this.nearby.length; i++)
      if ((this.nearby[i] as GroupCoverage).covers(x, y, this.epoch)) return true;
    return false;
  }

  /** Hex distance obeys the triangle inequality and never exceeds Manhattan distance, so no node within
   *  Manhattan `radius` of `(x, y)` lies inside the hex range unless `(x, y)` lies inside the range
   *  widened by `radius`; a group's coverage is ruled out by its bounds widened the same way. */
  mayAllowNear(x: number, y: number, radius: number): boolean {
    this.confirmKey();
    if (hexDistanceBetween(this.hx, this.hy, x, y) < GOODS_SEARCH_RANGE_NODES + radius) return true;
    for (let i = 0; i < this.nearby.length; i++) {
      const b = (this.nearby[i] as GroupCoverage).bounds;
      if (x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius)
        return true;
    }
    return false;
  }

  /** Throws once a world write moved the reach key since the limit was built. */
  private confirmKey(): void {
    const version = this.world.mutationVersion;
    if (version === this.confirmedAt) return;
    if (!versionsHold(this.versions, this.world, this.content, this.terrain)) {
      throw new Error('goods search limit asked after the signpost reach key moved; ask a fresh limit');
    }
    this.confirmedAt = version;
  }

  private ownSearch(): ReachArea {
    this.local ??= goodsReachAt(this.world, this.content, this.terrain, this.hx, this.hy);
    return this.local;
  }

  /** Whether the own search marks a post of nearby group `i`. */
  private catches(i: number): boolean {
    const known = this.caught[i];
    if (known !== UNASKED) return known === CAUGHT;
    const posts = this.nearbyPosts[i] as readonly SignpostSite[];
    let caught = false;
    if (this.local === undefined && this.floodMayEnter(this.hx, this.hy)) {
      const { world, content, terrain } = this;
      for (const p of posts) {
        if (!this.floodMayEnter(p.hx, p.hy)) continue;
        if (reachContains(postReach(world, content, terrain, p.entity, p.hx, p.hy), this.hx, this.hy)) {
          caught = true;
          break;
        }
      }
    } else {
      const local = this.ownSearch();
      caught = posts.some((p) => reachContains(local, p.hx, p.hy));
    }
    this.caught[i] = caught ? CAUGHT : MISSED;
    return caught;
  }

  /** Whether a goods flood can mark node `(x, y)` and start from it: unblocked, with nonzero resistance. */
  private floodMayEnter(x: number, y: number): boolean {
    const terrain = this.terrain;
    if (!terrain.inBounds(x, y)) return false;
    const node = terrain.nodeAt(x, y);
    // A walkable node's flood entry resistance is its resistanceAt; any other node's is zero.
    return (
      terrain.isWalkable(node) &&
      terrain.resistanceAt(node) !== 0 &&
      !signpostMask(this.world, this.content, terrain).has(node)
    );
  }
}

/** {@link GoodsSearchLimit} per nearby group states: not asked yet, caught, or not caught. */
const UNASKED = 0;
const CAUGHT = 1;
const MISSED = 2;

/** The posts filed in the tiles over a node box, a superset of those inside it. */
function postsWithin(cache: ReachCache, box: NodeBox): (SignpostSite & { player: number })[] {
  return cache.network.sites.within({
    minX: box.minX / 2,
    maxX: box.maxX / 2,
    minY: box.minY / 2,
    maxY: box.maxY / 2,
  });
}

/** A group's coverage, kept while the network holds. */
function coverageOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  cache: ReachCache,
  group: number,
): GroupCoverage {
  let coverage = cache.network.coverages.get(group);
  if (coverage === undefined) {
    coverage = new GroupCoverage(world, content, terrain, cache.network.groupPosts.get(group) ?? []);
    cache.network.coverages.set(group, coverage);
  }
  return coverage;
}

export interface SignpostReachPost {
  readonly id: number;
  readonly group: number;
  readonly area: ReachArea;
}
export interface SignpostReachView {
  readonly key: string;
  readonly player: number;
  readonly posts: readonly SignpostReachPost[];
  /** Building stock is reached at its door, not through its blocked body. */
  readonly doors: ReadonlyMap<number, { readonly hx: number; readonly hy: number }>;
  /** Local settlement searches also work before the first signpost is raised. */
  readonly settlements: readonly ReachArea[];
}

export function signpostReachView(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostReachView {
  const cache = cacheOf(world, content, terrain);
  const held = cache.views.get(player);
  if (held !== undefined) return held;
  const posts = (signpostNetwork(world).get(player) ?? []).map((post) => ({
    id: post.entity,
    group: post.group,
    area: postReach(world, content, terrain, post.entity, post.hx, post.hy),
  }));
  const doors = new Map<number, { hx: number; hy: number }>();
  const settlements: ReachArea[] = [];
  for (const [entity, door] of doorsOf(world, content, terrain).entries) {
    if (door.player !== player) continue;
    doors.set(entity, door);
    if (posts.length === 0) settlements.push(goodsReachAt(world, content, terrain, door.hx, door.hy));
  }
  const view = { key: reachKeyOf(cache.versions), player, posts, doors, settlements };
  cache.views.set(player, view);
  return view;
}
