import type { ContentSet } from '@open-northland/data';
import {
  GOODS_SEARCH_RANGE_NODES,
  Position,
  SIGNPOST_LINK_RANGE_NODES,
  SIGNPOST_LINK_STEPS,
  Signpost,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import {
  floodInspected,
  floodReach,
  originalReachBudget,
  type ReachSearch,
  type ReachTargets,
  reachCovers,
} from '../../nav/range-search.js';
import { repairReach } from '../../nav/reach-repair.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { type WalkBlockMask, walkBlockMask } from '../footprint/walk-block-mask.js';
import { syncRoadLane } from '../roads/index.js';

/** One context object per content set, so a per-call mask read allocates nothing. */
const contexts = new WeakMap<ContentSet, { readonly content: ContentSet }>();

/** The world's walk-block mask, levelled now, with the roads mirrored into `terrain` first. */
export function signpostMask(world: World, content: ContentSet, terrain: TerrainGraph): WalkBlockMask {
  syncRoadLane(world, terrain);
  let ctx = contexts.get(content);
  if (ctx === undefined) {
    ctx = { content };
    contexts.set(content, ctx);
  }
  return walkBlockMask(world, ctx, terrain);
}

/** A range search's hex range and what it spends: ground resistance, or steps without `groundCost`. */
export interface ReachSpan {
  readonly range: number;
  readonly budget: number;
  readonly groundCost: boolean;
  /** Whether callers read an answer only until they ask its holder again, so a fresh flood may write over
   *  the answer it replaces. */
  readonly readOnce: boolean;
}

export const GOODS_SEARCH_SPAN: ReachSpan = {
  range: GOODS_SEARCH_RANGE_NODES,
  budget: originalReachBudget(GOODS_SEARCH_RANGE_NODES),
  groundCost: true,
  readOnce: false,
};

export const SIGNPOST_LINK_SPAN: ReachSpan = {
  range: SIGNPOST_LINK_RANGE_NODES,
  budget: SIGNPOST_LINK_STEPS,
  groundCost: false,
  readOnce: true,
};

export interface TerrainReach extends ReachSearch {
  readonly terrain: TerrainGraph;
  readonly hx: number;
  readonly hy: number;
  readonly span: ReachSpan;
  /** The walk-block mask the flood read, and its version, the terrain's mirrored road revision and its
   *  resistance clock at the latest moment the answer was known to hold. */
  readonly mask: WalkBlockMask;
  maskVersion: number;
  roadRevision: number;
  resistanceClock: number;
}

/** A held search survives every change to a node its flood did not read, and is repaired in place for a
 *  few changes to nodes it did read. With `targets` the answer is exact only for whether each target is
 *  contained, and a held search serves while it covers them. */
export function terrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  span: ReachSpan,
  held?: TerrainReach,
  targets?: ReachTargets,
): TerrainReach {
  const mask = signpostMask(world, content, terrain);
  const maskVersion = mask.version;
  const roadRevision = terrain.mirroredRoadRevision;
  const sameQuestion =
    held?.terrain === terrain &&
    held.mask === mask &&
    held.hx === hx &&
    held.hy === hy &&
    held.span === span &&
    reachCovers(held, hx, hy, span.range, targets);
  if (sameQuestion && held.maskVersion === maskVersion && held.roadRevision === roadRevision) return held;
  const repaired = sameQuestion ? repairHeld(held, mask, terrain) : null;
  if (repaired === held) {
    held.maskVersion = maskVersion;
    held.roadRevision = roadRevision;
    held.resistanceClock = terrain.resistanceClock;
    return held;
  }
  if (repaired !== null) {
    return {
      ...repaired,
      terrain,
      hx,
      hy,
      span,
      mask,
      maskVersion,
      roadRevision,
      resistanceClock: terrain.resistanceClock,
    };
  }
  return {
    ...floodReach(
      terrain,
      mask.levelled(),
      hx,
      hy,
      span.range,
      span.budget,
      span.groundCost,
      targets,
      span.readOnce ? held : undefined,
    ),
    terrain,
    hx,
    hy,
    span,
    mask,
    maskVersion,
    roadRevision,
    resistanceClock: terrain.resistanceClock,
  };
}

/** Read nodes a held search takes in a repair before a fresh flood is the cheaper answer. */
const MAX_REPAIRED_CHANGES = 256;
/** The read nodes whose blocker or resistance changed since the held search being checked last held. */
const changedScratch: NodeId[] = [];
/** The search {@link listRead} checks and its map width, set only while a check runs. */
let checkedSearch: ReachSearch | undefined;
let checkedWidth = 0;
/** Lists a changed node the checked search read; true, ending the scan, once the list overflows. */
function listRead(x: number, y: number): boolean {
  if (checkedSearch === undefined || !floodInspected(checkedSearch, x, y)) return false;
  changedScratch.push((y * checkedWidth + x) as NodeId);
  return changedScratch.length > MAX_REPAIRED_CHANGES;
}

/** `held` itself while no node it read changed, else the repaired search, or null when only a fresh
 *  flood answers. */
function repairHeld(
  held: TerrainReach,
  mask: WalkBlockMask,
  terrain: TerrainGraph,
): TerrainReach | ReachSearch | null {
  changedScratch.length = 0;
  checkedSearch = held;
  checkedWidth = terrain.width;
  const overflow =
    mask.flippedSince(held.searched, held.maskVersion, listRead) ||
    terrain.resistanceChangedSince(held.searched, held.resistanceClock, listRead);
  checkedSearch = undefined;
  if (overflow) return null;
  if (changedScratch.length === 0) return held;
  const { range, budget, groundCost } = held.span;
  return repairReach(
    held,
    terrain,
    mask.levelled(),
    { hx: held.hx, hy: held.hy, range, budget, groundCost },
    changedScratch,
  );
}

/** Each signpost's reach per span, the link pass's and the goods search's. */
const postReaches = new WeakMap<World, Map<ReachSpan, Map<Entity, TerrainReach>>>();

/** {@link terrainReach} from signpost `post` standing on `(hx, hy)`, kept per post until it falls. Under a
 *  {@link ReachSpan.readOnce} span the answer holds only until the next call for the same post and span,
 *  whose flood may write over its buffers: read it at the call site, never keep it. */
export function postTerrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  post: Entity,
  hx: number,
  hy: number,
  span: ReachSpan,
  targets?: ReachTargets,
): TerrainReach {
  let bySpan = postReaches.get(world);
  if (bySpan === undefined) {
    bySpan = new Map();
    postReaches.set(world, bySpan);
  }
  let held = bySpan.get(span);
  if (held === undefined) {
    held = new Map();
    bySpan.set(span, held);
  }
  const found = terrainReach(world, content, terrain, hx, hy, span, held.get(post), targets);
  held.set(post, found);
  return found;
}

/**
 * Flood every standing post's reach before the first tick of a restored world, where a load pause is
 * expected: a held reach is only returned while it equals a fresh flood, so warming changes no answer,
 * and the first link pass and goods searches no longer flood every post inside one tick.
 */
export function warmPostReaches(world: World, content: ContentSet, terrain: TerrainGraph): void {
  for (const post of world.query(Signpost, Position)) {
    const p = world.get(post, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    postTerrainReach(world, content, terrain, post, hx, hy, SIGNPOST_LINK_SPAN);
    postTerrainReach(world, content, terrain, post, hx, hy, GOODS_SEARCH_SPAN);
  }
}

/** The signpost membership generation each world's post reaches were last pruned at. */
const prunedAt = new WeakMap<World, number>();

/** Forget the reaches of posts no longer alive. */
export function dropFallenPostReaches(world: World): void {
  const generation = world.componentGeneration(Signpost);
  if (prunedAt.get(world) === generation) return;
  prunedAt.set(world, generation);
  for (const held of postReaches.get(world)?.values() ?? []) {
    for (const post of held.keys()) if (!world.isAlive(post)) held.delete(post);
  }
}
