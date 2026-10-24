import { describe, expect, it } from 'vitest';
import {
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  PathFollow,
  wornSlot,
  writeEquipSlot,
} from '../../../src/components/index.js';
import { fx, ONE, ULP, ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { wearWornBoots } from '../../../src/systems/equipment/index.js';
import { dropPath } from '../../../src/systems/movement/nav-state.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

// A walk carries the boots' step wear in its PathFollow; the equipment record sees it when the walk ends.

/** Fixture shoes: 10000 rated uses, worn one use per roughness point. */
const SHOES = 8;
const SHOE_USES = 10_000;
const ROUGHNESS = 2;
const STEPS = 3;
const CARRYING_FACTOR = 2;

function walkingWearer(sim: Simulation, boots: EquipmentSlot): Entity {
  const e = sim.world.create();
  sim.world.add(e, Equipment, {
    boots,
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  sim.world.add(e, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
  return e;
}

const usesSpent = (uses: number) => fx.div(fx.fromInt(uses), fx.fromInt(SHOE_USES));

describe('boots step wear carried by the walk', () => {
  it('reads the walked wear mid-walk and settles it into the record when the walk ends', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    const e = walkingWearer(sim, { goodType: SHOES, degreeOfUse: ZERO });
    for (let i = 0; i < STEPS; i++) wearWornBoots(sim.world, ctx, e, ROUGHNESS, false);
    wearWornBoots(sim.world, ctx, e, ROUGHNESS, true);
    const expected = usesSpent(STEPS * ROUGHNESS + ROUGHNESS * CARRYING_FACTOR);
    expect(wornSlot(sim.world, e, 'boots', 0)).toEqual({ goodType: SHOES, degreeOfUse: expected });
    dropPath(sim.world, e);
    expect(sim.world.get(e, Equipment).boots).toEqual({ goodType: SHOES, degreeOfUse: expected });
  });

  it('a pair swapped mid-walk drops the old pair wear, and a pair breaking mid-walk is gone at once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    const e = walkingWearer(sim, { goodType: SHOES, degreeOfUse: ZERO });
    wearWornBoots(sim.world, ctx, e, ROUGHNESS, false);
    writeEquipSlot(sim.world, e, 'boots', 0, { goodType: SHOES, degreeOfUse: fx.sub(ONE, ULP) });
    expect(wornSlot(sim.world, e, 'boots', 0)?.degreeOfUse).toBe(fx.sub(ONE, ULP));
    wearWornBoots(sim.world, ctx, e, ROUGHNESS, false);
    expect(wornSlot(sim.world, e, 'boots', 0)).toBeNull();
    expect(sim.world.get(e, Equipment).boots).toBeNull();
  });
});
