import type { ContentSet } from '@open-northland/data';
import { Position } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import {
  type BlockerChannel,
  type BlockerStore,
  type BlockerVisit,
  BUILDING_ZONE,
  EXCLUSION,
  eachBlockerCell,
  MARKER,
  MOVABLE_BODY,
  OBSTACLE,
  PALISADE_BODY,
  RESOURCE_ANCHOR,
  UPGRADE_RESERVE,
} from '../blockers.js';

// Which nodes a blocker denies a work flag - ../blockers.ts channels projected onto this one rule.

/** One blocker's blocked nodes, in bounds, as an exact-length list: every standing resource holds one. */
export type BlockedCells = readonly NodeId[];

/** Every channel but the margin zones, which stay open ground for a flag. Exhaustive over
 *  {@link BlockerChannel}, so a channel added later must state its own answer here. */
const BLOCKS_WORK_FLAG: Record<BlockerChannel, boolean> = {
  [OBSTACLE]: true,
  [RESOURCE_ANCHOR]: true,
  [MARKER]: true,
  [EXCLUSION]: false,
  [BUILDING_ZONE]: false,
  [PALISADE_BODY]: true,
  [UPGRADE_RESERVE]: false,
  [MOVABLE_BODY]: false, // already counted through OBSTACLE
};

/** The nodes one capture collects before they are copied into its own array. */
const captureScratch: NodeId[] = [];

/** The entity's blocked nodes under `run`'s visitor - the shared channel/bounds filter of every capturer. */
function captureCells(terrain: TerrainGraph, run: (visit: BlockerVisit) => void): BlockedCells {
  captureScratch.length = 0;
  run((x, y, channel) => {
    if (BLOCKS_WORK_FLAG[channel] && terrain.inBounds(x, y)) captureScratch.push(terrain.nodeAt(x, y));
  });
  return captureScratch.slice();
}

/** The nodes `store`'s contribution for `e` denies a flag - the per-entity slice the incremental state
 *  captures and replays. */
export function blockedCellsOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  store: BlockerStore,
  e: Entity,
): BlockedCells {
  return captureCells(terrain, (v) => store.cells(world, content, e, v));
}

/** The node `markerBlockerCells` denies for a flag, or null for an unplaced or off-map flag: read without a
 *  visitor or a list, since the marker layer re-diffs every flag on any flag change. */
export function markerNode(world: World, terrain: TerrainGraph, e: Entity): NodeId | null {
  const p = world.tryGet(e, Position);
  if (p === undefined || !BLOCKS_WORK_FLAG[MARKER]) return null;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  return terrain.inBounds(hx, hy) ? terrain.nodeAt(hx, hy) : null;
}

/** The whole blocked set derived from live state in one pass - the reference the incremental state is
 *  proved against, so it must scan the same channels, markers included. */
export function rederiveBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>();
  eachBlockerCell(
    world,
    content,
    (x, y, channel) => {
      if (BLOCKS_WORK_FLAG[channel] && terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
    },
    'with-markers',
  );
  return blocked;
}
