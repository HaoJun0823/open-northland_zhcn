import { describe, expect, it } from 'vitest';
import { Crop, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

const WHEAT = 1;
const STAGES = 3;
const YIELD = 1;

function fieldAt(sim: Simulation, x: number, farm: Entity | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Crop, { goodType: WHEAT, farm, stage: 1, stages: STAGES, yieldUnits: YIELD });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 8) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  return { sim, pass: () => collectTargets(sim.world, ctxOf(sim), terrain).cropsByFarm };
}

describe('cropsByFarm - the farmers field groups kept across ticks', () => {
  it('follows fields sown, reaped and handed to another farm between passes', () => {
    const { sim, pass } = fixture();
    const [farmA, farmB] = [sim.world.create(), sim.world.create()];
    const fields = [
      fieldAt(sim, 2, farmA),
      fieldAt(sim, 4, farmA),
      fieldAt(sim, 6, farmB),
      fieldAt(sim, 8, null),
    ];
    expect(pass().get(farmA)).toEqual(fields.slice(0, 2));
    const [first, second, third] = fields;
    if (first === undefined || second === undefined || third === undefined) throw new Error('fields missing');
    sim.world.destroy(first);
    sim.world.mut(second, Crop).farm = farmB;
    const late = fieldAt(sim, 10, farmA);
    const groups = pass();
    expect(groups.get(farmA)).toEqual([late]);
    expect(groups.get(farmB)).toEqual([second, third]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
