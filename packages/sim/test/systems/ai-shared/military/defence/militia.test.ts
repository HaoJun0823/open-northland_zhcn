import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  JobAssignment,
  Militia,
  Position,
  Projectile,
  Settler,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import {
  MILITIA_HOLD_TICKS,
  MILITIA_PER_ZONE_MAX,
} from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { settlementDefenceSystem } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  AI_SEAT_SLOT_STEP_TICKS,
  COMPUTER_DECISION_INTERVAL_TICKS,
  MILITARY_DECISION_PHASE,
} from '../../../../../src/systems/computer-player/index.js';
import { setAiControl } from '../../../../../src/systems/orders/ai.js';
import { assignWorker } from '../../../../../src/systems/orders/work/employment.js';
import { WEAPON_MAIN_TYPE } from '../../../../../src/systems/readviews/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const CIVILIST = 6;
const HUNTER = 15;
const CARRIER = 24;
const SPEARMAN = 32;
const HUNTER_BOW = 30;
/** The bow's damage against an unarmoured man. */
const HUNTER_BOW_DAMAGE = 700;
const MAP = { width: 128, height: 96 };
const HQ_AT = { x: 24, y: 20 };
/** Where the raider waits while the town is set up, out of every soldier's sight. */
const FAR_OFF = { x: 120, y: 90 };
/** Inside the headquarters' watch band, beyond the bow's near reach of the seat's people. */
const RAIDER_OFFSET = 12;
/** The headquarters' carrier seats. */
const CARRIER_SEATS = 3;
/** Far outside the headquarters' zone. */
const ELSEWHERE = { x: 70, y: 80 };
/** Enough people that the per-zone cap, not the seat's share of its people, binds. */
const CROWD = 24;
/** The seat's first defence decision while the computer player runs it. */
const DEFENCE_TICK = SEAT * AI_SEAT_SLOT_STEP_TICKS + MILITARY_DECISION_PHASE;
/** The first of the seat's decisions after a militia armed at {@link DEFENCE_TICK} may stand down. */
const STAND_DOWN_TICK =
  DEFENCE_TICK +
  Math.ceil(MILITIA_HOLD_TICKS / COMPUTER_DECISION_INTERVAL_TICKS) * COMPUTER_DECISION_INTERVAL_TICKS;

/** The AI fixture with the hunter's trade and bow. */
function content(): ContentSet {
  const base = aiContent();
  const bow = base.weapons.find((w) => w.mainType === WEAPON_MAIN_TYPE.BOW);
  const civilist = base.jobs.find((j) => j.typeId === CIVILIST);
  if (bow === undefined || civilist === undefined) throw new Error('setup: the AI fixture lost its bow');
  return {
    ...base,
    jobs: [...base.jobs, { ...civilist, typeId: HUNTER, id: 'hunter', name: 'hunter' }],
    weapons: [
      ...base.weapons,
      { ...bow, typeId: HUNTER_BOW, id: 'hunter_bow', jobType: HUNTER, damage: { '0': HUNTER_BOW_DAMAGE } },
    ],
  };
}

function town(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(MAP.width, MAP.height) });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HQ_AT, tribe: VIKING, owner: SEAT });
  sim.step();
  const hq = [...sim.world.query(Building)][0];
  if (hq === undefined) throw new Error('setup: the headquarters was refused');
  return { sim, hq };
}

function spawn(sim: Simulation, jobType: number, x: number, y: number, owner: number): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: the spawn was refused');
  return spawned;
}

/** `count` of the seat's civilians in a row below the headquarters. */
function crowd(sim: Simulation, count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => spawn(sim, CIVILIST, HQ_AT.x - 8 + i, HQ_AT.y + 8, SEAT));
}

/** `seat` runs the computer player, the map AI alone, or nobody (a human). */
function control(sim: Simulation, seat: 'computer' | 'map' | 'human'): void {
  if (seat === 'human') return;
  setAiControl(sim.world, ctxOf(sim), {
    kind: 'setAiControl',
    player: SEAT,
    enabled: true,
    ...(seat === 'computer' ? {} : { computerEnabled: false }),
  });
}

/** An enemy spearman, stepped into the town with no tick between. */
function raiderIn(sim: Simulation): Entity {
  const raider = spawn(sim, SPEARMAN, FAR_OFF.x, FAR_OFF.y, FOE);
  sim.world.add(raider, Position, positionOfNode(HQ_AT.x + RAIDER_OFFSET, HQ_AT.y));
  return raider;
}

function decide(sim: Simulation, tick = DEFENCE_TICK): void {
  settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick });
}

function militia(sim: Simulation): Entity[] {
  return [...sim.world.query(Militia)].sort((a, b) => a - b);
}

describe('computer defence - desperate militia', () => {
  it('arms civilians as hunters against the raiders of a defenceless zone, up to the zone cap', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    const people = crowd(sim, CROWD);
    const raider = raiderIn(sim);

    decide(sim);

    const armed = militia(sim);
    expect(armed).toHaveLength(MILITIA_PER_ZONE_MAX);
    for (const e of armed) {
      expect(people).toContain(e);
      expect(sim.world.get(e, Settler).jobType).toBe(HUNTER);
      expect(sim.world.get(e, AttackOrder).target).toBe(raider);
      expect(sim.world.get(e, Militia).zone).toBe(hq);
    }
    // A second decision on the same zone arms nobody more.
    decide(sim, DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(armed);

    // And the hunters shoot him.
    const shooters = new Set<Entity>();
    for (let t = 0; t < COMPUTER_DECISION_INTERVAL_TICKS && shooters.size === 0; t++) {
      sim.step();
      for (const shot of sim.world.query(Projectile)) {
        const { source, target } = sim.world.get(shot, Projectile);
        if (target === raider && armed.includes(source)) shooters.add(source);
      }
    }
    expect(shooters.size).toBeGreaterThan(0);
  });

  it('arms nobody where its soldiers can hold the zone', () => {
    const { sim } = town();
    control(sim, 'computer');
    spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    crowd(sim, CROWD);
    raiderIn(sim);

    decide(sim);

    expect(militia(sim)).toEqual([]);
  });

  it('puts a militiaman back to his trade and workplace once the zone has been safe the hold', () => {
    const { sim, hq } = town();
    const carriers = crowd(sim, CARRIER_SEATS);
    for (const e of carriers) {
      const ctx = ctxOf(sim);
      assignWorker(sim.world, ctx, { kind: 'assignWorker', entity: e, building: hq, jobPriority: [CARRIER] });
    }
    // Far outside the zone, so only the carriers are near enough to arm.
    for (let i = 0; i < CROWD; i++) spawn(sim, CIVILIST, ELSEWHERE.x + i, ELSEWHERE.y, SEAT);
    // Only now, so the computer player's own staffing leaves the setup as it is.
    control(sim, 'computer');
    const raider = raiderIn(sim);
    decide(sim);
    const armed = militia(sim);
    expect(armed).toEqual(carriers);
    for (const e of armed) expect(sim.world.has(e, JobAssignment)).toBe(false);

    sim.world.destroy(raider);
    decide(sim, STAND_DOWN_TICK - COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(armed);
    decide(sim, STAND_DOWN_TICK);

    expect(militia(sim)).toEqual([]);
    for (const e of armed) {
      expect(sim.world.get(e, Settler).jobType).toBe(CARRIER);
      expect(sim.world.get(e, JobAssignment).workplace).toBe(hq);
    }
  });

  it('never arms the people of a human seat or one only the map AI runs', () => {
    for (const seat of ['human', 'map'] as const) {
      const { sim } = town();
      control(sim, seat);
      crowd(sim, CROWD);
      raiderIn(sim);

      for (let tick = 0; tick < COMPUTER_DECISION_INTERVAL_TICKS; tick++) decide(sim, tick);

      expect(militia(sim)).toEqual([]);
    }
  });

  it('keeps its militia through a save', () => {
    const { sim } = town();
    control(sim, 'computer');
    crowd(sim, CROWD);
    raiderIn(sim);
    decide(sim);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: sim.content,
      map: grassNodeMap(MAP.width, MAP.height),
    });

    expect(restored.hashState()).toBe(sim.hashState());
    expect(militia(restored)).toEqual(militia(sim));
  });
});
