import {
  type ContentSet,
  fullStateBlockAreaCells,
  type LandscapeGfx,
  levelBlockAreaCells,
} from '@open-northland/data';
import {
  ResourceFootprint,
  type ResourceFootprintCells,
  type ResourceFootprintData,
  type ResourceFootprintRecordKey,
  type ResourceFootprintStandIn,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { worldContent } from '../../core/world-content.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Convert one decoded `[GfxLandscape]` record into its footprint cells. The source stores repeated rows
 * per valency and growth state: a node placed at a known `level` blocks its rows up to that level, as the
 * original stamps it, and one without the full-grown object's cells. Approximation: collision stays at
 * the placed size until the node is removed, where the original's shrinks as the valency is spent.
 */
export function resourceFootprintFromLandscapeGfx(
  record: LandscapeGfx,
  level?: number,
): ResourceFootprintCells {
  const blocks = (areas: LandscapeGfx['walkBlockAreas']) =>
    level === undefined ? fullStateBlockAreaCells(areas) : levelBlockAreaCells(areas, level);
  return {
    walk: blocks(record.walkBlockAreas),
    build: blocks(record.buildBlockAreas),
    work: fullStateBlockAreaCells(record.workAreas),
    sourceGfxIndex: record.index,
  };
}

/** The non-blocking stand-in for a node whose good resolves no landscape record (the synthetic fixtures,
 *  the sandbox catalog, real goods with no `[GfxLandscape]` stage such as wool). The `work` entry naming
 *  the node's own anchor is an invention, since a real record's work area is the neighbour ring. */
const ANCHOR_ONLY_CELLS: ResourceFootprintCells = { walk: [], build: [], work: [{ dx: 0, dy: 0 }] };

/** A chest for content shipping no chest record: it blocks its own cell and is worked from a neighbour,
 *  the wooden record's shape. */
const CHEST_STAND_IN_CELLS: ResourceFootprintCells = { walk: [{ dx: 0, dy: 0 }], build: [], work: [] };

const STAND_IN_CELLS: Readonly<Record<ResourceFootprintStandIn, ResourceFootprintCells>> = {
  anchor: ANCHOR_ONLY_CELLS,
  chest: CHEST_STAND_IN_CELLS,
};

/** Packing of a record key: `((gfx * LEVEL_SLOTS) + levelSlot) * BUILD_VARIANTS + buildFree`, where slot
 *  0 is the full-grown footprint and slot `level + 1` a placed valency. */
const LEVEL_SLOTS = 1 << 16;
const BUILD_VARIANTS = 2;

const recordCellsByContent = new WeakMap<ContentSet, Map<number, ResourceFootprintCells>>();

function recordFootprintCells(content: ContentSet, key: ResourceFootprintRecordKey): ResourceFootprintCells {
  const levelSlot = key.level === undefined ? 0 : key.level + 1;
  if (!Number.isInteger(levelSlot) || levelSlot < 0 || levelSlot >= LEVEL_SLOTS) {
    throw new Error(`resource footprint level ${key.level} is outside the keyed range`);
  }
  const packed = (key.gfx * LEVEL_SLOTS + levelSlot) * BUILD_VARIANTS + (key.buildFree === true ? 1 : 0);
  let memo = recordCellsByContent.get(content);
  if (memo === undefined) {
    memo = new Map();
    recordCellsByContent.set(content, memo);
  }
  const held = memo.get(packed);
  if (held !== undefined) return held;
  const record = contentIndex(content).landscapeGfxByIndex.get(key.gfx);
  if (record === undefined)
    throw new Error(`resource footprint names landscape record ${key.gfx}, which the content lacks`);
  const cells = resourceFootprintFromLandscapeGfx(record, key.level);
  const resolved = key.buildFree === true ? { ...cells, build: [] } : cells;
  memo.set(packed, resolved);
  return resolved;
}

/** The cells `footprint` names, shared and read-only: a keyed footprint resolves against the world's
 *  content. */
export function resourceFootprintCells(
  world: World,
  footprint: Readonly<ResourceFootprintData>,
): ResourceFootprintCells {
  return 'gfx' in footprint ? recordFootprintCells(worldContent(world), footprint) : unkeyedCells(footprint);
}

/** {@link resourceFootprintCells} against `content`, for a reader holding no world. */
export function contentFootprintCells(
  content: ContentSet,
  footprint: Readonly<ResourceFootprintData>,
): ResourceFootprintCells {
  return 'gfx' in footprint ? recordFootprintCells(content, footprint) : unkeyedCells(footprint);
}

function unkeyedCells(
  footprint: Exclude<ResourceFootprintData, ResourceFootprintRecordKey>,
): ResourceFootprintCells {
  return 'walk' in footprint ? footprint : STAND_IN_CELLS[footprint.standIn];
}

/** {@link resourceFootprintCells} of `resource`'s footprint, which it must carry. */
export function footprintCellsOf(world: World, resource: Entity): ResourceFootprintCells {
  return resourceFootprintCells(world, world.get(resource, ResourceFootprint));
}

/** {@link footprintCellsOf}, or undefined when `resource` carries no footprint. */
export function tryFootprintCellsOf(world: World, resource: Entity): ResourceFootprintCells | undefined {
  const footprint = world.tryGet(resource, ResourceFootprint);
  return footprint === undefined ? undefined : resourceFootprintCells(world, footprint);
}
