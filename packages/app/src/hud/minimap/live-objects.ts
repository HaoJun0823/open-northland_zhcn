import {
  type MinimapFeature,
  type MinimapObjectChanges,
  type MinimapObjects,
  minimapFeatureOfGood,
} from '@open-northland/render/data';
import {
  cellOfNode,
  FOG_STATE,
  type FogView,
  firstDifference,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { num, positionOf, type SnapshotEntity } from '../../game/snapshot/index.js';
import { MINIMAP_OBJECT_TYPES } from './bake.js';

/**
 * The minimap's forest and ore from the standing harvestable nodes the sim holds now, so a felled
 * tree, a planted one and a worked-out deposit show once the surface rebakes. A map's harvestable
 * placements spawn as these nodes, so a fresh world draws what the map authored.
 */

/** The node changes a good's log keeps; a reader further behind walks every node again. */
const CHANGE_LOG = 4096;

/** One good's standing nodes: how many stand on each half-cell node, a count of the changes, and the
 *  node of each of the last {@link CHANGE_LOG} changes at `log[revision % CHANGE_LOG]`. */
interface GoodNodes {
  readonly countByNode: Map<number, number>;
  revision: number;
  readonly log: Int32Array;
}

type StandingNodes = Map<number, GoodNodes>;

/** The numbers one placement takes in a baker's objects: `hx`, `hy` and the object type. */
const PLACEMENT_STRIDE = 3;

/** A node key packs `(hx, hy)` as `hy * NODE_KEY_ROW + hx`, wider than any map's lattice row. */
const NODE_KEY_ROW = 1 << 16;

function standingNodeOf(entity: SnapshotEntity): { goodType: number; node: number } | undefined {
  const resource = entity.components.Resource as { goodType?: unknown } | undefined;
  const goodType = num(resource?.goodType);
  const position = positionOf(entity);
  if (goodType === undefined || position === undefined) return undefined;
  const { hx, hy } = nodeOfPosition(position.x, position.y);
  return { goodType, node: hy * NODE_KEY_ROW + hx };
}

function count(state: StandingNodes, entity: SnapshotEntity, delta: number): void {
  const standing = standingNodeOf(entity);
  if (standing === undefined) return;
  let good = state.get(standing.goodType);
  if (good === undefined) {
    good = { countByNode: new Map(), revision: 0, log: new Int32Array(CHANGE_LOG) };
    state.set(standing.goodType, good);
  }
  const left = (good.countByNode.get(standing.node) ?? 0) + delta;
  if (left > 0) good.countByNode.set(standing.node, left);
  else good.countByNode.delete(standing.node);
  good.log[good.revision % CHANGE_LOG] = standing.node;
  good.revision++;
}

/** The counts alone: a revision depends on the history, not the entities. */
function countsOf(state: StandingNodes): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const [goodType, good] of state) {
    if (good.countByNode.size > 0) out.set(goodType, good.countByNode);
  }
  return out;
}

const STANDING_NODES: SnapshotIndexSpec<StandingNodes> = {
  name: 'minimap standing nodes',
  // A resource node never moves, so its position is read only when it is placed.
  reads: { values: ['Resource'], presence: ['Position'] },
  empty: () => new Map(),
  add: (state, entity) => count(state, entity, 1),
  remove: (state, entity) => count(state, entity, -1),
  replace: (state, previous, next) => {
    const before = standingNodeOf(previous);
    const after = standingNodeOf(next);
    if (before?.goodType === after?.goodType && before?.node === after?.node) return;
    count(state, previous, -1);
    count(state, next, 1);
  },
  differs: (held, fresh) => firstDifference(countsOf(held), countsOf(fresh)),
};

/** The goods the minimap draws a standing node of, by sim good type. */
export function minimapFeatureOfGoodTypes(
  goods: readonly { readonly id: string; readonly typeId: number }[],
): ReadonlyMap<number, MinimapFeature> {
  const out = new Map<number, MinimapFeature>();
  for (const good of goods) {
    const feature = minimapFeatureOfGood(good.id);
    if (feature !== undefined) out.set(good.typeId, feature);
  }
  return out;
}

/** A number that grows whenever a drawn good's standing nodes change. */
export function standingNodesRevision(
  snapshot: WorldSnapshot,
  featureOfGoodType: ReadonlyMap<number, MinimapFeature>,
): number {
  const state = indexesOf(snapshot).get(STANDING_NODES);
  let revision = 0;
  for (const goodType of featureOfGoodType.keys()) revision += state.get(goodType)?.revision ?? 0;
  return revision;
}

/** Count by node key, per sim good type. */
type CountsByGood = Map<number, Map<number, number>>;

export interface SeenStandingObjects {
  /** Whether {@link refresh} may change the picture: the standing nodes changed since the last refresh,
   *  or a difference still hidden may have come into view under a new fog view. */
  stale(snapshot: WorldSnapshot, fog: FogView | null): boolean;
  /** Take each node's live count where the viewer sees its cell now, or everywhere without fog; true
   *  when the picture changed. The first refresh walks the drawn goods' standing nodes; a later one
   *  reads the nodes the index logged as changed since, with the differences fog still hides, and walks
   *  everything only once more changes came than the log holds. */
  refresh(snapshot: WorldSnapshot, fog: FogView | null): boolean;
  /** The picture as a baker's objects: one pass over the seen nodes. Starts the next {@link changes}. */
  objects(): MinimapObjects;
  /** What the picture took since the last {@link objects} or changes, as a baker's object changes. */
  changes(): MinimapObjectChanges;
}

/**
 * The minimap's forest and ore as the viewer last saw them, so felling and mining in explored but
 * unseen ground stay hidden as the world view's fog ghosts keep them. Approximation: the first refresh
 * takes the standing nodes everywhere, so the mount-time picture is the authored or saved forest,
 * including what a rival worked before a save in ground the viewer never saw again.
 */
export function createSeenStandingObjects(
  featureOfGoodType: ReadonlyMap<number, MinimapFeature>,
): SeenStandingObjects {
  const seen: CountsByGood = new Map();
  /** Nodes whose live count differs from the seen one while fog hides their cell. */
  const hidden = new Map<number, Set<number>>();
  /** Per good, the index state and revision the last refresh read up to. */
  const readTo = new Map<number, { readonly nodes: GoodNodes | undefined; readonly revision: number }>();
  /** Per good, the seen count of each node the picture changed since the last objects or changes. */
  const before: CountsByGood = new Map();
  let seeded = false;
  let refreshedRevision = 0;
  /** The fog view the last refresh saw, by its seat and generation; null seat when fog was off. */
  let refreshedSeat: number | null = null;
  let refreshedGeneration = 0;

  const seenOf = (goodType: number): Map<number, number> => {
    let nodes = seen.get(goodType);
    if (nodes === undefined) {
      nodes = new Map();
      seen.set(goodType, nodes);
    }
    return nodes;
  };
  const visible = (fog: FogView | null, node: number): boolean => {
    if (fog === null) return true;
    const { cx, cy } = cellOfNode(node % NODE_KEY_ROW, Math.floor(node / NODE_KEY_ROW));
    return fog.stateAt(cx, cy) === FOG_STATE.VISIBLE;
  };
  /** Apply a differing live count where it shows; otherwise remember it as hidden. True when applied. */
  const take = (
    fog: FogView | null,
    goodType: number,
    nodes: Map<number, number>,
    hiddenNodes: Set<number>,
    node: number,
    live: number,
  ): boolean => {
    if (!visible(fog, node)) {
      hiddenNodes.add(node);
      return false;
    }
    let was = before.get(goodType);
    if (was === undefined) {
      was = new Map();
      before.set(goodType, was);
    }
    if (!was.has(node)) was.set(node, nodes.get(node) ?? 0);
    if (live > 0) nodes.set(node, live);
    else nodes.delete(node);
    hiddenNodes.delete(node);
    return true;
  };

  return {
    stale: (snapshot, fog) => {
      if (!seeded || standingNodesRevision(snapshot, featureOfGoodType) !== refreshedRevision) return true;
      if (hidden.size === 0) return false;
      return (
        (fog?.player ?? null) !== refreshedSeat || (fog !== null && fog.generation !== refreshedGeneration)
      );
    },
    refresh: (snapshot, fog) => {
      const state = indexesOf(snapshot).get(STANDING_NODES);
      const view = seeded ? fog : null;
      let changed = !seeded;
      for (const goodType of featureOfGoodType.keys()) {
        const good = state.get(goodType);
        const live = good?.countByNode;
        const nodes = seenOf(goodType);
        const hiddenNodes = hidden.get(goodType) ?? new Set<number>();
        const read = readTo.get(goodType);
        const revision = good?.revision ?? 0;
        const differs = (node: number, count: number): boolean => (nodes.get(node) ?? 0) !== count;
        if (!seeded || read === undefined || read.nodes !== good || revision - read.revision > CHANGE_LOG) {
          hiddenNodes.clear();
          for (const [node, count] of live ?? []) {
            if (differs(node, count) && take(view, goodType, nodes, hiddenNodes, node, count)) changed = true;
          }
          for (const node of nodes.keys()) {
            if (live?.has(node) !== true && take(view, goodType, nodes, hiddenNodes, node, 0)) changed = true;
          }
        } else {
          const logged = new Set<number>();
          for (let at = read.revision; at < revision; at++) logged.add(good?.log[at % CHANGE_LOG] ?? 0);
          for (const node of hiddenNodes) logged.add(node);
          for (const node of logged) {
            const count = live?.get(node) ?? 0;
            if (!differs(node, count)) hiddenNodes.delete(node);
            else if (take(view, goodType, nodes, hiddenNodes, node, count)) changed = true;
          }
        }
        if (hiddenNodes.size > 0) hidden.set(goodType, hiddenNodes);
        else hidden.delete(goodType);
        readTo.set(goodType, { nodes: good, revision });
      }
      seeded = true;
      refreshedRevision = standingNodesRevision(snapshot, featureOfGoodType);
      refreshedSeat = fog?.player ?? null;
      refreshedGeneration = fog?.generation ?? 0;
      return changed;
    },
    objects: () => {
      before.clear();
      let standingTotal = 0;
      for (const goodType of featureOfGoodType.keys()) {
        for (const standing of seen.get(goodType)?.values() ?? []) standingTotal += standing;
      }
      const placements = new Int32Array(standingTotal * PLACEMENT_STRIDE);
      let at = 0;
      for (const [goodType, feature] of featureOfGoodType) {
        const nodes = seen.get(goodType);
        if (nodes === undefined) continue;
        const type = MINIMAP_OBJECT_TYPES.indexOf(feature);
        for (const [node, standing] of nodes) {
          const hx = node % NODE_KEY_ROW;
          const hy = Math.floor(node / NODE_KEY_ROW);
          for (let i = 0; i < standing; i++) {
            placements[at++] = hx;
            placements[at++] = hy;
            placements[at++] = type;
          }
        }
      }
      return { types: MINIMAP_OBJECT_TYPES, placements };
    },
    changes: () => {
      const list: number[] = [];
      for (const [goodType, was] of before) {
        const feature = featureOfGoodType.get(goodType);
        if (feature === undefined) continue;
        const type = MINIMAP_OBJECT_TYPES.indexOf(feature);
        const nodes = seen.get(goodType);
        for (const [node, count] of was) {
          const delta = (nodes?.get(node) ?? 0) - count;
          if (delta !== 0) list.push(node % NODE_KEY_ROW, Math.floor(node / NODE_KEY_ROW), type, delta);
        }
      }
      before.clear();
      return { types: MINIMAP_OBJECT_TYPES, changes: Int32Array.from(list) };
    },
  };
}
