import { describe, expect, it } from 'vitest';
import { aiControlEntity, Health, Owner, SeatOffenders } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import {
  forgetOffenders,
  liveOffenders,
  noteOffence,
  OFFENDER_MEMORY_TICKS,
} from '../../../src/systems/conflict/offenders.js';
import { setAiControl } from '../../../src/systems/orders/ai.js';
import { resolveCombatHit } from '../../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

const P0 = 0;
const P1 = 1;
const ROW = 0;
const MAP_CELLS = 30;
const BLOW = { damage: 10 };
const HARMLESS_BLOW = { damage: 0 };

type Seat = 'computer' | 'closed' | 'human';

function sim(seat: Seat): Simulation {
  const s = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(MAP_CELLS, 2) });
  if (seat !== 'human') {
    setAiControl(s.world, ctxOf(s), {
      kind: 'setAiControl',
      player: P0,
      enabled: true,
      ...(seat === 'closed' ? { computerEnabled: false } : {}),
    });
  }
  return s;
}

/** A woman of `owner` on node `hx` of the row. */
function woman(s: Simulation, hx: number, owner: number): Entity {
  const e = fighterAtNode(s, hx, ROW, owner === P0 ? VIKING : SAXON, WOMAN);
  s.world.add(e, Owner, { player: owner });
  return e;
}

function remembered(s: Simulation, tick = s.tick): Entity[] {
  return liveOffenders(s.world, P0, tick).map((o) => o.entity);
}

describe('offender memory - whom a computer seat remembers', () => {
  it("remembers whoever lands a damaging blow on a computer seat's person, and no one for another seat", () => {
    for (const seat of ['computer', 'closed', 'human'] as const) {
      const s = sim(seat);
      const victim = woman(s, 10, P0);
      const raider = woman(s, 9, P1);
      const harmless = woman(s, 11, P1);
      resolveCombatHit(s.world, ctxOf(s), raider, victim, BLOW, [], 'melee');
      resolveCombatHit(s.world, ctxOf(s), harmless, victim, HARMLESS_BLOW, [], 'melee');

      expect(remembered(s)).toEqual(seat === 'computer' ? [raider] : []);
    }
  });

  it('forgets an offender once the memory runs out after his last offence, and a dead one at once', () => {
    const s = sim('computer');
    const scout = woman(s, 5, P1);
    const thief = woman(s, 6, P1);
    noteOffence(s.world, ctxOf(s), scout, P0);
    noteOffence(s.world, ctxOf(s), thief, P0);
    const lastOffence = s.tick;

    s.world.mut(thief, Health).hitpoints = 0;
    expect(remembered(s)).toEqual([scout]);
    expect(remembered(s, lastOffence + OFFENDER_MEMORY_TICKS - 1)).toEqual([scout]);
    expect(remembered(s, lastOffence + OFFENDER_MEMORY_TICKS)).toEqual([]);

    forgetOffenders(s.world, P0, lastOffence + OFFENDER_MEMORY_TICKS);
    const carrier = aiControlEntity(s.world, P0);
    expect(carrier !== null && s.world.has(carrier, SeatOffenders)).toBe(false);
  });

  it('keeps its offenders through a save', () => {
    const s = sim('computer');
    const scout = woman(s, 5, P1);
    noteOffence(s.world, ctxOf(s), scout, P0);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s)))), {
      content: s.content,
      map: grass(MAP_CELLS, 2),
    });

    expect(restored.hashState()).toBe(s.hashState());
    expect(remembered(restored)).toEqual([scout]);
  });
});
