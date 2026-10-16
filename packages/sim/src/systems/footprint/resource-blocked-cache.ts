import { footprintCellDx } from '@open-northland/data';
import { Position, ResourceFootprint } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { countsMatchCells, sameCells } from './geometry.js';

// The incrementally-maintained per-world cache of cells standing resource nodes make unwalkable, plus its
// coherence verifier - the resource twin of ./building-blocked-cache.ts.

/** Anchor packing for an entry (`hx * STRIDE + hy`): a small integer, so an entry holds no object. */
const ANCHOR_KEY_STRIDE = 1 << 16;

/**
 * The nodes with a positive count, read through the counts so the cells cost no node-keyed set. Membership
 * and size are O(1); iteration walks the whole map in node order, which only the verifier and tests do.
 */
class CountedNodeSet implements ReadonlySet<NodeId> {
  size = 0;

  constructor(private readonly counts: Uint16Array) {}

  has(node: NodeId): boolean {
    return (this.counts[node] ?? 0) > 0;
  }

  *values(): IterableIterator<NodeId> {
    const { counts } = this;
    for (let node = 0; node < counts.length; node++) if ((counts[node] ?? 0) > 0) yield node as NodeId;
  }

  keys(): IterableIterator<NodeId> {
    return this.values();
  }

  *entries(): IterableIterator<[NodeId, NodeId]> {
    for (const node of this.values()) yield [node, node];
  }

  [Symbol.iterator](): IterableIterator<NodeId> {
    return this.values();
  }

  forEach(visit: (value: NodeId, key: NodeId, set: ReadonlySet<NodeId>) => void): void {
    for (const node of this.values()) visit(node, node, this);
  }
}

interface ResourceBlockedCache extends CountedCells {
  generation: number;
  readonly terrain: TerrainGraph;
  readonly cells: CountedNodeSet;
  /** The resources covering each node. Overlapping footprints stack a handful deep, far below the
   *  Uint16 range. */
  readonly counts: Uint16Array;
  /** The anchor each counted resource was stamped at. Its walk cells are re-read from its footprint on
   *  removal, so a footprint must leave the cache before its component changes or goes. */
  readonly entries: Map<Entity, number>;
  /** The nodes that entered or left {@link cells} since {@link takeResourceBlockFlips} last drained them,
   *  for its one reader; a node may repeat. Past {@link FLIP_LOG_CAP} entries the log is dropped and marked
   *  lost, so a cache nobody drains stays bounded. */
  readonly flips: NodeId[];
  flipsLost: boolean;
}

const FLIP_LOG_CAP = 8192;

function logFlip(cache: ResourceBlockedCache, node: NodeId): void {
  if (cache.flips.length >= FLIP_LOG_CAP) {
    cache.flips.length = 0;
    cache.flipsLost = true;
  }
  cache.flips.push(node);
}

const resourceBlockedCache = new WeakMap<World, ResourceBlockedCache>();

/** Add `delta` (+1 or -1) to the count of every in-bounds walk cell of `resource`'s footprint anchored at
 *  `(hx, hy)`, returning whether any cell was in bounds. */
function stampWalkCells(
  cache: ResourceBlockedCache,
  world: World,
  resource: Entity,
  hx: number,
  hy: number,
  delta: number,
): boolean {
  const { terrain, counts, cells } = cache;
  let any = false;
  for (const c of world.get(resource, ResourceFootprint).walk) {
    const x = hx + footprintCellDx(hy, c);
    const y = hy + c.dy;
    if (!terrain.inBounds(x, y)) continue;
    any = true;
    const cell = terrain.nodeAt(x, y);
    const count = (counts[cell] ?? 0) + delta;
    // The Uint16 lane would wrap an unbalanced removal to a huge count instead of failing.
    if (count < 0) throw new Error(`resource walk cell ${cell} unblocked more often than blocked`);
    counts[cell] = count;
    if (count === 0) cells.size -= 1;
    else if (count === 1 && delta > 0) cells.size += 1;
    else continue;
    logFlip(cache, cell);
  }
  return any;
}

/** Count `resource`'s walk cells at its current Position, recording its anchor when any lies in bounds. */
function addEntry(cache: ResourceBlockedCache, world: World, resource: Entity): void {
  const p = world.tryGet(resource, Position);
  if (p === undefined) return;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
  if (stampWalkCells(cache, world, resource, hx, hy, 1))
    cache.entries.set(resource, hx * ANCHOR_KEY_STRIDE + hy);
}

function removeEntry(cache: ResourceBlockedCache, world: World, resource: Entity): void {
  const anchor = cache.entries.get(resource);
  if (anchor === undefined) return;
  cache.entries.delete(resource);
  const hx = Math.floor(anchor / ANCHOR_KEY_STRIDE);
  stampWalkCells(cache, world, resource, hx, anchor - hx * ANCHOR_KEY_STRIDE, -1);
}

/** Count a freshly stamped footprint; the previous one must already have left through
 *  {@link removeResourceBlockedCacheEntry}. */
export function refreshResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  addEntry(cache, world, resource);
  syncResourceBlockedCacheGeneration(world);
}

/** Uncount `resource`'s footprint. Call while its ResourceFootprint is still the one counted. */
export function removeResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  removeEntry(cache, world, resource);
}

export function syncResourceBlockedCacheGeneration(world: World): void {
  const cache = resourceBlockedCache.get(world);
  if (cache !== undefined) cache.generation = world.componentGeneration(ResourceFootprint);
}

function deriveResourceBlockedCache(world: World, terrain: TerrainGraph): ResourceBlockedCache {
  const counts = new Uint16Array(terrain.nodeCount);
  const cache: ResourceBlockedCache = {
    generation: world.componentGeneration(ResourceFootprint),
    terrain,
    cells: new CountedNodeSet(counts),
    counts,
    entries: new Map(),
    flips: [],
    flipsLost: false,
  };
  for (const e of world.query(ResourceFootprint, Position)) addEntry(cache, world, e);
  cache.flips.length = 0;
  return cache;
}

function verifyResourceBlockedCache(world: World, terrain: TerrainGraph): string[] {
  const cached = resourceBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain) return [];
  if (cached.generation !== world.componentGeneration(ResourceFootprint)) return [];
  // The cells are read through the counts, so this checks the held size against them.
  if (!countsMatchCells(cached.counts, cached.cells)) {
    return ['resourceBlockedCells counts disagree with its cells - a node count missed a stamp'];
  }
  const fresh = deriveResourceBlockedCache(world, terrain).cells;
  if (!sameCells(cached.cells, fresh)) {
    return [
      `resourceBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - stale resource footprint overlay`,
    ];
  }
  return [];
}

/**
 * The cells standing resource nodes make unwalkable. Built once per world/terrain and maintained by
 * `stampResourceFootprint` / `unstampResourceFootprint`, so clearing a forest mutates just the affected
 * node's cells instead of scanning every resource on the next route. A direct ResourceFootprint store
 * mutation still falls back to a full rebuild.
 */
export function resourceBlockedCells(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  return resourceBlockedLayer(world, terrain).cells;
}

/** {@link resourceBlockedCells} with its live per-node counts, for the dynamic overlay. */
export function resourceBlockedLayer(world: World, terrain: TerrainGraph): CountedCells {
  const generation = world.componentGeneration(ResourceFootprint);
  const cached = resourceBlockedCache.get(world);
  if (cached !== undefined && cached.terrain === terrain && cached.generation === generation) {
    return cached;
  }

  const cache = deriveResourceBlockedCache(world, terrain);
  resourceBlockedCache.set(world, cache);
  world.registerCacheVerifier('resourceBlockedCells', () => verifyResourceBlockedCache(world, terrain));
  return cache;
}

/**
 * Move the nodes {@link resourceBlockedLayer}'s cells gained or lost since the previous call into `into`,
 * returning false when the log was dropped in between or no layer exists, so the reader must re-read the
 * whole layer. One reader per world: the walk-block mask's levelling.
 */
export function takeResourceBlockFlips(world: World, terrain: TerrainGraph, into: NodeId[]): boolean {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined || cache.terrain !== terrain) return false;
  const kept = !cache.flipsLost;
  if (kept) for (const node of cache.flips) into.push(node);
  cache.flips.length = 0;
  cache.flipsLost = false;
  return kept;
}
