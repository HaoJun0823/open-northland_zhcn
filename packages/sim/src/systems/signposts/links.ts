import type { ContentSet } from '@open-northland/data';
import { Owner, Position, Signpost } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { TileBuckets } from '../../inspect/tile-buckets.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import { floodReach, reachContains } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { signpostNetworkRevision } from './network.js';
import {
  dropFallenPostReaches,
  postTerrainReach,
  SIGNPOST_LINK_SPAN,
  signpostMask,
} from './terrain-reach.js';

interface Site {
  readonly id: Entity;
  readonly hx: number;
  readonly hy: number;
}
interface Sites {
  readonly generation: number;
  readonly buckets: TileBuckets<Site>;
}
const sites = new WeakMap<World, Sites>();
function sitesOf(world: World): TileBuckets<Site> {
  const generation = world.componentGeneration(Signpost);
  let held = sites.get(world);
  if (held === undefined || held.generation !== generation) {
    const buckets = new TileBuckets<Site>();
    for (const id of world.query(Signpost, Position)) {
      const p = world.get(id, Position);
      const n = nodeOfPosition(p.x, p.y);
      buckets.set(id, { id, ...n }, n.hx / 2, n.hy / 2);
    }
    held = { generation, buckets };
    sites.set(world, held);
  }
  return held.buckets;
}

/** Scratch for the sites a link search collects, refilled per post: the search calls nothing that
 *  searches links again. */
const nearbyScratch: Site[] = [];
const linkTargets = { nodes: nearbyScratch, count: 0 };
const linkedScratch: Entity[] = [];
const mergedScratch: Entity[] = [];
const NO_BLOCKS: BlockOverlay = { size: 0, has: () => false };
const ascending = (a: Entity, b: Entity): number => a - b;
/** The tile box a link search collects sites over, rewritten per post. */
const siteBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Each post's latest link list, handed out again while it is unchanged; never stored in a component. */
const heldLinks = new WeakMap<World, Map<Entity, readonly Entity[]>>();

/** The same player's posts `post`'s reach takes in, ascending. The flood stops once it has taken in
 *  every candidate it can, as only their containment is asked. Callers must not keep the list. */
function reachableLinks(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): readonly Entity[] {
  const p = world.get(post, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
  const r = SIGNPOST_LINK_SPAN.range;
  const owner = world.get(post, Owner).player;
  siteBox.minX = (hx - r) / 2;
  siteBox.maxX = (hx + r) / 2;
  siteBox.minY = (hy - r) / 2;
  siteBox.maxY = (hy + r) / 2;
  const count = sitesOf(world).collect(siteBox, nearbyScratch);
  let candidates = 0;
  for (let i = 0; i < count; i++) {
    const site = nearbyScratch[i] as Site;
    if (site.id !== post && world.tryGet(site.id, Owner)?.player === owner)
      nearbyScratch[candidates++] = site;
  }
  if (candidates === 0) return NO_LINKS;
  linkTargets.count = candidates;
  const { budget, groundCost } = SIGNPOST_LINK_SPAN;
  const area =
    content === undefined
      ? floodReach(terrain, NO_BLOCKS, hx, hy, r, budget, groundCost, linkTargets).area
      : postTerrainReach(world, content, terrain, post, hx, hy, SIGNPOST_LINK_SPAN, linkTargets).area;
  linkedScratch.length = 0;
  for (let i = 0; i < candidates; i++) {
    const site = nearbyScratch[i] as Site;
    if (reachContains(area, site.hx, site.hy)) linkedScratch.push(site.id);
  }
  linkedScratch.sort(ascending);
  let byPost = heldLinks.get(world);
  if (byPost === undefined) {
    byPost = new Map();
    heldLinks.set(world, byPost);
  }
  const held = byPost.get(post);
  if (held !== undefined && sameIds(held, linkedScratch)) return held;
  const linked = linkedScratch.slice();
  byPost.set(post, linked);
  return linked;
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Links follow {@link SIGNPOST_LINK_SPAN}, whatever the ground's resistance.
 *  Link count remains uncapped; the original retains at most eight neighbours. */
export function settleSignpostLinks(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  const linked = reachableLinks(world, terrain, post, content);
  world.mut(post, Signpost).links = linked.slice();
  for (const other of linked) {
    const links = world.get(other, Signpost).links;
    if (!links.includes(post)) world.mut(other, Signpost).links = [...links, post].sort((a, b) => a - b);
  }
}

/** The mask version, road revision and network revision each world's links were last settled at. */
interface Layout {
  mask: number;
  roads: number;
  network: number;
}
const layouts = new WeakMap<World, Layout>();

/** Per pass, the posts' own link lists by post index, and the posts naming each post as a flat list
 *  ascending per post: `incomingStart[i]` to `incomingStart[i + 1]` of `incoming` for post `i`. */
const outgoing: (readonly Entity[])[] = [];
let incomingStart = new Int32Array(0);
let incoming = new Int32Array(0);

/** A changed road, building or landscape can connect or cut an existing network. */
export const signpostLinksSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const held = layouts.get(world);
  // The mask is read first: it mirrors the roads into the terrain.
  const mask = signpostMask(world, ctx.content, terrain).version;
  const network = signpostNetworkRevision(world);
  if (held?.mask === mask && held.roads === terrain.mirroredRoadRevision && held.network === network) return;
  const posts = world.canonicalQuery(Signpost, Position, Owner);
  dropFallenPostReaches(world);
  dropFallenLinks(world);
  // A link is either post's reach taking the other in: each post's own list, and the posts whose list
  // names it, gathered in ascending post order.
  outgoing.length = 0;
  if (incomingStart.length < posts.length + 1) incomingStart = new Int32Array(posts.length + 1);
  incomingStart.fill(0, 0, posts.length + 1);
  let named = 0;
  for (const post of posts) {
    const linked = reachableLinks(world, terrain, post, ctx.content);
    outgoing.push(linked);
    for (const other of linked) {
      const at = indexOf(posts, other);
      if (at < 0) continue;
      incomingStart[at + 1] = (incomingStart[at + 1] as number) + 1;
      named++;
    }
  }
  for (let i = 0; i < posts.length; i++)
    incomingStart[i + 1] = (incomingStart[i + 1] as number) + (incomingStart[i] as number);
  if (incoming.length < named) incoming = new Int32Array(named);
  // Filled in ascending post order, each post's span ends ascending; the fill moves each start to its end.
  for (let i = 0; i < posts.length; i++) {
    for (const other of outgoing[i] as readonly Entity[]) {
      const at = indexOf(posts, other);
      if (at < 0) continue;
      incoming[incomingStart[at] as number] = posts[i] as Entity;
      incomingStart[at] = (incomingStart[at] as number) + 1;
    }
  }
  let from = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i] as Entity;
    const to = incomingStart[i] as number;
    const links = mergeAscending(outgoing[i] as readonly Entity[], incoming, from, to, mergedScratch);
    if (!sameIds(world.get(post, Signpost).links, links)) world.mut(post, Signpost).links = links.slice();
    from = to;
  }
  outgoing.length = 0;
  // Settling links moves the network revision, so the layout is read after it.
  const layout = held ?? { mask: 0, roads: 0, network: 0 };
  layout.mask = signpostMask(world, ctx.content, terrain).version;
  layout.roads = terrain.mirroredRoadRevision;
  layout.network = signpostNetworkRevision(world);
  layouts.set(world, layout);
};

/** `post`'s index in the ascending list `posts`, or -1. */
function indexOf(posts: readonly Entity[], post: Entity): number {
  let low = 0;
  let high = posts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const at = posts[mid] as Entity;
    if (at === post) return mid;
    if (at < post) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

const NO_LINKS: readonly Entity[] = [];

/** The signpost membership generation each world's held links were last pruned at. */
const linksPrunedAt = new WeakMap<World, number>();

function dropFallenLinks(world: World): void {
  const byPost = heldLinks.get(world);
  const generation = world.componentGeneration(Signpost);
  if (byPost === undefined || linksPrunedAt.get(world) === generation) return;
  linksPrunedAt.set(world, generation);
  for (const post of byPost.keys()) if (!world.isAlive(post)) byPost.delete(post);
}

/** The union of ascending id lists `a` and `b`'s `from` to `to`, ascending and without repeats, written
 *  over `out`. */
function mergeAscending(
  a: readonly Entity[],
  b: Int32Array,
  from: number,
  to: number,
  out: Entity[],
): Entity[] {
  out.length = 0;
  let i = 0;
  let j = from;
  while (i < a.length || j < to) {
    const x = a[i];
    const y = j < to ? (b[j] as Entity) : undefined;
    if (y === undefined || (x !== undefined && x < y)) {
      out.push(x as Entity);
      i++;
    } else if (x === undefined || y < x) {
      out.push(y);
      j++;
    } else {
      out.push(x);
      i++;
      j++;
    }
  }
  return out;
}

/** Drop a falling post from its neighbours' link lists, before it is destroyed. */
export function unlinkSignpost(world: World, post: Entity): void {
  for (const other of world.get(post, Signpost).links) {
    const links = world.tryMut(other, Signpost);
    if (links !== undefined) links.links = links.links.filter((e) => e !== post);
  }
}

/** Re-settle the links of a post that changed hands: it leaves its old owner's posts and joins the new
 *  owner's in range. Source basis: the original's guide rescan links same-player guides only. */
export function relinkSignpost(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  unlinkSignpost(world, post);
  world.mut(post, Signpost).links = [];
  settleSignpostLinks(world, terrain, post, content);
}
