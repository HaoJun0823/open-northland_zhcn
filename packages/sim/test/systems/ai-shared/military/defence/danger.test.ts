import { describe, expect, it } from 'vitest';
import { Armor, Building, Position, Settler } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../../src/index.js';
import {
  isDesperate,
  unitDanger,
  type ZoneThreat,
} from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { planSettlementDefence } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import { noteOffence } from '../../../../../src/systems/conflict/offenders.js';
import { setAiControl } from '../../../../../src/systems/orders/ai.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const CIVILIST = 6;
const BARE_SOLDIER = 31;
const SPEARMAN = 32;
const ARMOUR_CLASS = 1;
const HQ_AT = { x: 24, y: 20 };
/** Where the enemies wait while the town is set up, out of every soldier's sight. */
const FAR_OFF = { x: 120, y: 90 };

function sim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
}

function spawn(s: Simulation, jobType: number, owner: number, at = FAR_OFF): Entity {
  const before = new Set(s.world.query(Settler));
  s.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.x, y: at.y, tribe: VIKING, owner });
  s.step();
  const spawned = [...s.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: the spawn was refused');
  return spawned;
}

describe('computer defence - danger', () => {
  it("weighs a unit by the original's values: civilian 1, soldier 10, and 10 for armour and for a weapon", () => {
    const s = sim();
    const ctx = ctxOf(s);
    const armoured = spawn(s, SPEARMAN, FOE);
    s.world.add(armoured, Armor, { armorClass: ARMOUR_CLASS });

    expect(unitDanger(s.world, ctx, spawn(s, CIVILIST, FOE))).toBe(1);
    expect(unitDanger(s.world, ctx, spawn(s, BARE_SOLDIER, FOE))).toBe(10);
    expect(unitDanger(s.world, ctx, spawn(s, SPEARMAN, FOE))).toBe(20);
    expect(unitDanger(s.world, ctx, armoured)).toBe(30);
  });

  it('sums the raiders and the offenders inside a zone, an offender ten times over, and leaves a passer-by out', () => {
    const s = sim();
    s.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HQ_AT, tribe: VIKING, owner: SEAT });
    s.step();
    const hq = [...s.world.query(Building)][0];
    setAiControl(s.world, ctxOf(s), { kind: 'setAiControl', player: SEAT, enabled: true });
    const raider = spawn(s, SPEARMAN, FOE);
    const thief = spawn(s, CIVILIST, FOE);
    const passerBy = spawn(s, CIVILIST, FOE);
    noteOffence(s.world, ctxOf(s), thief, SEAT);
    for (const [i, e] of [raider, thief, passerBy].entries()) {
      s.world.add(e, Position, positionOfNode(HQ_AT.x + 8 + 2 * i, HQ_AT.y));
    }
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');

    const { zones } = planSettlementDefence(s.world, ctxOf(s), terrain, SEAT, true).threat;

    expect(zones.map((z) => z.anchor)).toEqual([hq]);
    expect(zones[0]?.intruders.map((i) => i.entity)).toEqual([raider, thief]);
    expect(zones[0]?.danger).toBe(20 + 1 * 10);
  });

  it('calls a zone desperate when its armed danger is far over its defence, or merely over it where nothing shelters it', () => {
    const zone = (armedDanger: number, defence: number, fortified: boolean, unarmed = 0): ZoneThreat => ({
      anchor: 1 as Entity,
      x: 0,
      y: 0,
      radius: 0,
      intruders: [],
      danger: armedDanger + unarmed,
      armedDanger,
      defence,
      fortified,
    });

    expect(isDesperate(zone(30, 20, false))).toBe(true);
    expect(isDesperate(zone(30, 20, true))).toBe(false);
    expect(isDesperate(zone(50, 20, true))).toBe(true);
    // Under the defend threshold nothing is desperate, defenceless or not.
    expect(isDesperate(zone(5, 0, false))).toBe(false);
    // Unarmed offenders alone never make a zone desperate, however heavily they weigh.
    expect(isDesperate(zone(0, 0, false, 30))).toBe(false);
  });
});
