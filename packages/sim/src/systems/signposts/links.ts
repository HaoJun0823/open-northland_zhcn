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
  signpostTerrainKey,
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
  const count = sitesOf(world).collect(
    { minX: (hx - r) / 2, maxX: (hx + r) / 2, minY: (hy - r) / 2, maxY: (hy + r) / 2 },
    nearbyScratch,
  );
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

const layouts = new WeakMap<World, string>();
/** A changed road, building or landscape can connect or cut an existing network. */
export const signpostLinksSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const key = `${signpostTerrainKey(world, ctx.content, terrain)}:${signpostNetworkRevision(world)}`;
  if (layouts.get(world) === key) return;
  const posts = world.canonicalQuery(Signpost, Position, Owner);
  dropFallenPostReaches(world);
  dropFallenLinks(world);
  // A link is either post's reach taking the other in: each post's own list, and the posts whose list
  // names it, gathered in ascending post order.
  const outgoing: (readonly Entity[])[] = [];
  const incoming = new Map<Entity, Entity[]>();
  for (const post of posts) {
    const linked = reachableLinks(world, terrain, post, ctx.content);
    outgoing.push(linked);
    for (const other of linked) {
      const into = incoming.get(other);
      if (into === undefined) incoming.set(other, [post]);
      else into.push(post);
    }
  }
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i] as Entity;
    const links = mergeAscending(
      outgoing[i] as readonly Entity[],
      incoming.get(post) ?? NO_LINKS,
      mergedScratch,
    );
    if (!sameIds(world.get(post, Signpost).links, links)) world.mut(post, Signpost).links = links.slice();
  }
  layouts.set(world, `${signpostTerrainKey(world, ctx.content, terrain)}:${signpostNetworkRevision(world)}`);
};

const NO_LINKS: readonly Entity[] = [];

function dropFallenLinks(world: World): void {
  const byPost = heldLinks.get(world);
  if (byPost === undefined) return;
  for (const post of byPost.keys()) if (!world.isAlive(post)) byPost.delete(post);
}

/** The union of two ascending id lists, ascending and without repeats, written over `out`. */
function mergeAscending(a: readonly Entity[], b: readonly Entity[], out: Entity[]): Entity[] {
  out.length = 0;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
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
