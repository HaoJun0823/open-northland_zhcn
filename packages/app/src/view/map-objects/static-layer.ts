import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { forEachPlacement } from '../../content/map/placements.js';
import { bindFootprintClearing, type FootprintBuildingType } from './footprint-clearing.js';
import {
  bindHarvestableHandover,
  type HarvestableHandover,
  retireStaticHarvestables,
  type StaticDrawSurface,
} from './harvestable-handover.js';
import { SightDeferral, type SightGate } from './sight-deferral.js';

/** A decoded map's placed landscape objects as the static layer drew them. */
export interface StaticLayerObjects<Sprite> {
  readonly placements: readonly number[];
  readonly byPlacement: ReadonlyMap<number, Sprite>;
}

/**
 * How the map's harvestable placements met the sim: spawned by this boot, each as one entity, or restored
 * from a save, which pool-draws every one from the loaded state. A fresh boot's chests and ground goods
 * are pool-drawn from the start too: only a sim-drawn item is on screen for a click or a tooltip to find.
 */
export type HarvestableSpawn =
  | {
      readonly kind: 'fresh';
      readonly placementByEntity: readonly (readonly [Entity, number])[];
      readonly pooledPlacements: readonly number[];
    }
  | { readonly kind: 'restored'; readonly placements: readonly number[] };

export interface StaticLayerBinding<Sprite> {
  /** Per-frame hook: harvestables hand over to the sprite pool as they are worked, and building
   *  footprints and roads clear the scenery under them. */
  readonly onEvents: (events: readonly SimEvent[]) => void;
  /** The static quad still drawing a harvestable entity; see {@link HarvestableHandover.spriteOf}. */
  readonly harvestableSpriteOf: (entity: number) => Sprite | undefined;
  /** Per-frame hook: applies the changes made in the fog that the viewer now sees. */
  readonly onFrame: () => void;
}

/**
 * Bind the static landscape layer to the sim for the map's lifetime. A harvestable's quad stays with
 * its entity, whose razing the handover retires; a change in the fog waits for the viewer's `sight`.
 */
export function bindStaticLayer<Sprite>(
  surface: StaticDrawSurface<Sprite>,
  objects: StaticLayerObjects<Sprite>,
  harvestables: HarvestableSpawn,
  content: { readonly buildings: readonly FootprintBuildingType[] },
  snapshot: () => WorldSnapshot,
  nodeWidth: number,
  sight: SightGate,
): StaticLayerBinding<Sprite> {
  const deferral = new SightDeferral(sight);
  const nodes = new Map<number, { readonly hx: number; readonly hy: number }>();
  forEachPlacement(objects.placements, (hx, hy, _type, ordinal) => nodes.set(ordinal, { hx, hy }));
  let handover: HarvestableHandover<Sprite> | null = null;
  const harvestablePlacements = new Set<number>();
  if (harvestables.kind === 'fresh') {
    handover = bindHarvestableHandover(
      surface,
      harvestables.placementByEntity,
      objects.byPlacement,
      deferral,
      (placement) => nodes.get(placement),
    );
    for (const [, placement] of harvestables.placementByEntity) harvestablePlacements.add(placement);
    retireStaticHarvestables(surface, harvestables.pooledPlacements, objects.byPlacement);
    for (const placement of harvestables.pooledPlacements) harvestablePlacements.add(placement);
  } else {
    retireStaticHarvestables(surface, harvestables.placements, objects.byPlacement);
    for (const placement of harvestables.placements) harvestablePlacements.add(placement);
  }
  const scenery = new Map<number, Sprite>();
  for (const [placement, sprite] of objects.byPlacement) {
    if (!harvestablePlacements.has(placement)) scenery.set(placement, sprite);
  }
  const clearing = bindFootprintClearing(
    surface,
    objects.placements,
    scenery,
    content,
    snapshot,
    nodeWidth,
    deferral,
  );
  return {
    onEvents: (events) => {
      handover?.onEvents(events);
      clearing(events);
    },
    harvestableSpriteOf: (entity) => handover?.spriteOf(entity),
    onFrame: () => deferral.flush(),
  };
}
