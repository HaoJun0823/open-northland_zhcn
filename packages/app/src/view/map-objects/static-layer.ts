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
 * What the viewer last saw of the static layer, for a save to carry: the placements whose quad left the
 * layer, the harvestables still drawn as quads by entity, and the placements whose change waits for the
 * viewer's sight.
 */
export interface StaticLayerMemory {
  readonly removed: readonly number[];
  readonly held: readonly (readonly [entity: number, placement: number])[];
  readonly waiting: readonly number[];
}

/**
 * How the map's harvestable placements met the sim: spawned by this boot, each as one entity, or restored
 * from a save. A restore with the saved layer memory keeps the quads the viewer last saw; without it every
 * harvestable is pool-drawn from the loaded state. A fresh boot's chests and ground goods are pool-drawn
 * from the start too: only a sim-drawn item is on screen for a click or a tooltip to find.
 */
export type HarvestableSpawn =
  | {
      readonly kind: 'fresh';
      readonly placementByEntity: readonly (readonly [Entity, number])[];
      readonly pooledPlacements: readonly number[];
    }
  | {
      readonly kind: 'restored';
      readonly placements: readonly number[];
      readonly memory?: StaticLayerMemory | undefined;
    };

export interface StaticLayerBinding<Sprite> {
  /** Per-frame hook: harvestables hand over to the sprite pool as they are worked, and building
   *  footprints and roads clear the scenery under them. */
  readonly onEvents: (events: readonly SimEvent[]) => void;
  /** The static quad still drawing a harvestable entity; see {@link HarvestableHandover.spriteOf}. */
  readonly harvestableSpriteOf: (entity: number) => Sprite | undefined;
  /** Per-frame hook: applies the changes made in the fog that the viewer now sees. */
  readonly onFrame: () => void;
  readonly memory: () => StaticLayerMemory;
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
  const placementOf = new Map<Sprite, number>();
  for (const [placement, sprite] of objects.byPlacement) placementOf.set(sprite, placement);
  const removed = new Set<number>();
  const tracked: StaticDrawSurface<Sprite> = {
    setStaticallyDrawnRefs: (refs) => surface.setStaticallyDrawnRefs(refs),
    removeMapObject: (sprite) => {
      const placement = placementOf.get(sprite);
      if (placement !== undefined) removed.add(placement);
      surface.removeMapObject(sprite);
    },
  };
  const nodeOf = (placement: number) => nodes.get(placement);

  let handover: HarvestableHandover<Sprite> | null = null;
  const harvestablePlacements = new Set<number>();
  const memory = harvestables.kind === 'restored' ? harvestables.memory : undefined;
  if (harvestables.kind === 'fresh') {
    handover = bindHarvestableHandover(
      tracked,
      harvestables.placementByEntity,
      objects.byPlacement,
      deferral,
      nodeOf,
    );
    for (const [, placement] of harvestables.placementByEntity) harvestablePlacements.add(placement);
    retireStaticHarvestables(tracked, harvestables.pooledPlacements, objects.byPlacement);
    for (const placement of harvestables.pooledPlacements) harvestablePlacements.add(placement);
  } else if (memory !== undefined) {
    for (const placement of harvestables.placements) harvestablePlacements.add(placement);
    retireStaticHarvestables(tracked, memory.removed, objects.byPlacement);
    handover = bindHarvestableHandover(
      tracked,
      memory.held.map(([entity, placement]) => [entity as Entity, placement] as const),
      objects.byPlacement,
      deferral,
      nodeOf,
    );
    const held = new Set(memory.held.map(([, placement]) => placement));
    retireStaticHarvestables(
      tracked,
      harvestables.placements.filter((placement) => !held.has(placement) && !removed.has(placement)),
      objects.byPlacement,
    );
    const heldEntity = new Map(memory.held.map(([entity, placement]) => [placement, entity]));
    for (const placement of memory.waiting) {
      const entity = heldEntity.get(placement);
      if (entity !== undefined) handover?.retireWhenSeen(entity);
    }
  } else {
    retireStaticHarvestables(tracked, harvestables.placements, objects.byPlacement);
    for (const placement of harvestables.placements) harvestablePlacements.add(placement);
  }
  const scenery = new Map<number, Sprite>();
  for (const [placement, sprite] of objects.byPlacement) {
    if (!harvestablePlacements.has(placement) && !removed.has(placement)) scenery.set(placement, sprite);
  }
  const clearing = bindFootprintClearing(
    tracked,
    objects.placements,
    scenery,
    content,
    snapshot,
    nodeWidth,
    deferral,
    // A remembered layer already shows the map as the viewer saw it: what it has not, waits.
    memory !== undefined,
  );
  return {
    onEvents: (events) => {
      handover?.onEvents(events);
      clearing(events);
    },
    harvestableSpriteOf: (entity) => handover?.spriteOf(entity),
    onFrame: () => deferral.flush(),
    memory: () => ({
      removed: [...removed],
      held: handover?.held() ?? [],
      waiting: [...deferral.waiting()],
    }),
  };
}
