import { components, SnapshotDeltaStream, SnapshotMirror, takeSnapshot, World } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type DrawItem, newDrawItem } from '../src/data/scene/draw-item.js';
import { assignStaticFields, copyStaticFields } from '../src/data/scene/snapshot-readers/static-readers.js';
import { buildingLandscapeOverlays } from '../src/data/sprites/layered.js';
import type { BuildingTypeBinding } from '../src/data/sprites/layered-bindings.js';

function newDrawItemWith(ref: number, fields: Partial<DrawItem>): DrawItem {
  return { ...newDrawItem('building', ref, 0, 0, 0, undefined), ...fields };
}

describe('scripted house layers', () => {
  it('reads on/off slots, retains them in fog and drops layers during construction', () => {
    const item = newDrawItem('building', 1, 0, 0, 0, undefined);
    assignStaticFields(item, 'building', {
      Building: { buildingType: 42, tribe: 2, built: 65536 },
      HouseLandscapeOverlays: {
        slots: [
          [0, true],
          [1, false],
          [6, true],
        ],
      },
    });
    expect(item.landscapeOverlayMask).toBe(65);
    const ghost = newDrawItem('building', 1, 0, 0, 0, undefined);
    copyStaticFields(ghost, item);
    expect(ghost.landscapeOverlayMask).toBe(65);
    const overlays = [{ slot: 0, layer: 'flame', frames: [4], x: 0, y: 0, animated: false }];
    const binding: BuildingTypeBinding = {
      byType: { 42: 1 },
      default: 1,
      landscapeOverlaysByType: { 42: { 0: overlays } },
    };
    expect(buildingLandscapeOverlays(binding, item)).toBe(overlays);
    expect(buildingLandscapeOverlays(binding, { ...item, builtPct: 50 })).toEqual([]);
    expect(buildingLandscapeOverlays(binding, { ...item, landscapeOverlayMask: 0 })).toEqual([]);
  });

  it('draws only the slots its record lists at the building level', () => {
    const LIGHTHOUSE = 47;
    const TOP_STAGE = 2;
    const AUTHORED_REF = 3;
    const fire = [{ slot: 0, layer: 'fire', frames: [4], x: 0, y: 0, animated: true }];
    const binding: BuildingTypeBinding = {
      byType: { [LIGHTHOUSE]: 1 },
      byTypeLevel: { [LIGHTHOUSE]: { 0: 1, 1: 2, [TOP_STAGE]: 3 } },
      default: 1,
      landscapeOverlaysByType: { [LIGHTHOUSE]: { [TOP_STAGE]: fire } },
      byEntity: new Map([
        [AUTHORED_REF, { typeId: LIGHTHOUSE, tribe: 5, level: TOP_STAGE, body: 3, landscapeOverlays: fire }],
      ]),
    };
    const lit = (ref: number, level: number) =>
      newDrawItemWith(ref, { typeId: LIGHTHOUSE, tribe: 5, level, landscapeOverlayMask: 1 });
    expect(buildingLandscapeOverlays(binding, lit(1, TOP_STAGE))).toBe(fire);
    expect(buildingLandscapeOverlays(binding, lit(1, 0))).toEqual([]);
    expect(buildingLandscapeOverlays(binding, lit(AUTHORED_REF, TOP_STAGE))).toBe(fire);
    // Rebuilt at level 0 by a script: the authored top stage's fire goes with its body.
    expect(buildingLandscapeOverlays(binding, lit(AUTHORED_REF, 0))).toEqual([]);
  });

  it('reads the slots a sim write sends through a snapshot and the worker mirror', () => {
    const world = new World();
    const source = { world, tick: 0, events: { current: () => [] } };
    const stream = new SnapshotDeltaStream(source);
    const mirror = new SnapshotMirror();
    const house = world.create();
    world.add(house, components.HouseLandscapeOverlays, {
      slots: new Map([
        [3, true],
        [0, true],
        [5, false],
      ]),
    });
    const delta = stream.next();
    if (delta === null) throw new Error('delta expected');
    mirror.apply(delta);
    for (const snapshot of [takeSnapshot(world, 0, []), mirror.snapshot()]) {
      const read = snapshot.entities[0]?.components;
      if (read === undefined) throw new Error('house expected');
      const item = newDrawItem('building', 1, 0, 0, 0, undefined);
      assignStaticFields(item, 'building', read);
      expect(item.landscapeOverlayMask).toBe(0b1001);
    }
  });
});
