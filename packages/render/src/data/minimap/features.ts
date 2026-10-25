import { clamp } from '../math.js';
import { staggerBlur } from './grid.js';
import { MINIMAP_DEPOSIT_KINDS, type MinimapDepositKind } from './scene.js';

/**
 * The placed-object half of the minimap scene. Which placed object is forest or a deposit is content:
 * the caller resolves each `EditName` through the IR's gathering-pipeline harvest join
 * (`[GfxLandscape]` index → the good it yields) and passes {@link minimapFeatureOfGood} of that good.
 * This module only bins the classified placements into the raster's lanes, so the raster stays
 * content-free.
 */

export type MinimapFeature = 'forest' | MinimapDepositKind;

/**
 * How the minimap depicts the objects that yield each good, keyed by the IR `goodId`: a presentation
 * binding like an icon, not a game rule. A good absent here draws nothing.
 */
const FEATURE_OF_GOOD: ReadonlyMap<string, MinimapFeature> = new Map([
  ['wood', 'forest'],
  ['stone', 'stone'],
  ['mud', 'clay'],
  ['iron', 'iron'],
  ['gold', 'gold'],
]);

export function minimapFeatureOfGood(goodId: string): MinimapFeature | undefined {
  return FEATURE_OF_GOOD.get(goodId);
}

/** The placed objects as the decoded map stores them: flat `[hx, hy, typeIndex]` half-cell triples. A
 *  typed array crosses to a bake worker as one copy, where a long number array is cloned item by item. */
export interface MinimapObjects {
  readonly types: readonly string[];
  readonly placements: ArrayLike<number>;
}

/** Changes to placed objects since an earlier {@link MinimapObjects}: flat `[hx, hy, typeIndex, delta]`
 *  quadruples, a delta of how many more (or, negative, fewer) objects of the type stand on the node. */
export interface MinimapObjectChanges {
  readonly types: readonly string[];
  readonly changes: ArrayLike<number>;
}

/** The `MinimapScene` lanes placed objects fill. */
export interface MinimapObjectLanes {
  readonly forest: Float32Array;
  readonly depositKind: Uint8Array;
  readonly depositDensity: Float32Array;
}

/** The objects standing in each cell, the lanes' input: trees, and deposits per kind (cell-major, one
 *  count per kind of {@link MINIMAP_DEPOSIT_KINDS}). */
export interface MinimapObjectCounts {
  readonly width: number;
  readonly height: number;
  readonly trees: Float32Array;
  readonly deposits: Float32Array;
}

/** Objects per cell, averaged over the cell and its six neighbours, that make a full canopy or a full
 *  ore field. */
const TREES_FOR_FULL_CANOPY = 0.8;
const DEPOSITS_FOR_FULL_FIELD = 0.5;
const PLACEMENT_STRIDE = 3;
const CHANGE_STRIDE = 4;
const DEPOSIT_KINDS = MINIMAP_DEPOSIT_KINDS.length;
/** Half-cell lattice nodes per cell along each axis. */
const NODES_PER_CELL = 2;

/**
 * Bin classified placements into per-cell canopy density and deposit kind and density. A node counts
 * toward the cell of its row pair; when deposits of several kinds share a cell, the later kind in
 * {@link MINIMAP_DEPOSIT_KINDS} (the rarer one) names it.
 */
export function minimapObjectLanes(
  width: number,
  height: number,
  objects: MinimapObjects,
  featureOf: (editName: string) => MinimapFeature | undefined,
): MinimapObjectLanes {
  return minimapLanesOfCounts(minimapObjectCounts(width, height, objects, featureOf));
}

/** The per-cell counts of `objects`, which {@link changeMinimapObjectCounts} keeps current. */
export function minimapObjectCounts(
  width: number,
  height: number,
  objects: MinimapObjects,
  featureOf: (editName: string) => MinimapFeature | undefined,
): MinimapObjectCounts {
  const cells = width * height;
  const counts = {
    width,
    height,
    trees: new Float32Array(cells),
    deposits: new Float32Array(cells * DEPOSIT_KINDS),
  };
  const featureOfType = objects.types.map((name) => featureOf(name));
  const { placements } = objects;
  for (let i = 0; i + PLACEMENT_STRIDE - 1 < placements.length; i += PLACEMENT_STRIDE) {
    const feature = featureOfType[placements[i + 2] ?? -1];
    if (feature !== undefined) count(counts, feature, placements[i] ?? 0, placements[i + 1] ?? 0, 1);
  }
  return counts;
}

/** Apply `changes` to `counts` in place. */
export function changeMinimapObjectCounts(
  counts: MinimapObjectCounts,
  changes: MinimapObjectChanges,
  featureOf: (editName: string) => MinimapFeature | undefined,
): void {
  const featureOfType = changes.types.map((name) => featureOf(name));
  const list = changes.changes;
  for (let i = 0; i + CHANGE_STRIDE - 1 < list.length; i += CHANGE_STRIDE) {
    const feature = featureOfType[list[i + 2] ?? -1];
    if (feature !== undefined) count(counts, feature, list[i] ?? 0, list[i + 1] ?? 0, list[i + 3] ?? 0);
  }
}

function count(
  counts: MinimapObjectCounts,
  feature: MinimapFeature,
  hx: number,
  hy: number,
  delta: number,
): void {
  const { width, height } = counts;
  const row = clamp(Math.floor(hy / NODES_PER_CELL), 0, height - 1);
  const col = clamp(Math.floor((hx - (row & 1)) / NODES_PER_CELL), 0, width - 1);
  const cell = row * width + col;
  if (feature === 'forest') {
    counts.trees[cell] = (counts.trees[cell] ?? 0) + delta;
    return;
  }
  const at = cell * DEPOSIT_KINDS + MINIMAP_DEPOSIT_KINDS.indexOf(feature);
  counts.deposits[at] = (counts.deposits[at] ?? 0) + delta;
}

/** The scene lanes of `counts`. */
export function minimapLanesOfCounts(counts: MinimapObjectCounts): MinimapObjectLanes {
  const { width, height } = counts;
  const cells = width * height;
  const deposits = new Float32Array(cells);
  const kinds = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    let total = 0;
    for (let kind = 0; kind < DEPOSIT_KINDS; kind++) {
      const standing = counts.deposits[cell * DEPOSIT_KINDS + kind] ?? 0;
      if (standing <= 0) continue;
      total += standing;
      kinds[cell] = kind + 1;
    }
    deposits[cell] = total;
  }
  return {
    forest: neighbourhoodDensity(counts.trees, width, height, TREES_FOR_FULL_CANOPY),
    depositKind: kinds,
    depositDensity: neighbourhoodDensity(deposits, width, height, DEPOSITS_FOR_FULL_FIELD),
  };
}

function neighbourhoodDensity(
  counts: Float32Array,
  width: number,
  height: number,
  full: number,
): Float32Array {
  const out = staggerBlur(counts, width, height);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, (out[i] ?? 0) / full);
  return out;
}
