import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AttackOrder, Building, Position, Settler } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../../src/index.js';
import { settlementDefenceSystem } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  AI_SEAT_SLOT_STEP_TICKS,
  COMPUTER_DECISION_INTERVAL_TICKS,
  MILITARY_DECISION_PHASE,
  threatWatchNodes,
} from '../../../../../src/systems/computer-player/index.js';
import { STRIKE_BACK_PARTY } from '../../../../../src/systems/conflict/leash.js';
import { noteOffence } from '../../../../../src/systems/conflict/offenders.js';
import { setAiControl } from '../../../../../src/systems/orders/ai.js';
import { WEAPON_MAIN_TYPE } from '../../../../../src/systems/readviews/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const CIVILIST = 6;
const SCOUT = 27;
const SPEARMAN = 32;
const CIVILIAN_FIST = 98;
const HQ_AT = { x: 24, y: 20 };
/** Where the scout waits while the town is set up, out of every soldier's sight. */
const FAR_OFF = { x: 120, y: 90 };
/** Inside the headquarters' watch band, with room for the seat's people between. */
const INTRUDER_OFFSET = 10;
/** The seat's first defence decision while the computer player runs it. */
const DEFENCE_TICK = SEAT * AI_SEAT_SLOT_STEP_TICKS + MILITARY_DECISION_PHASE;

/** The AI fixture with fists for its civilians, who strike back with them. */
function content(): ContentSet {
  const base = aiContent();
  const soldierFist = base.weapons.find((w) => w.mainType === WEAPON_MAIN_TYPE.UNARMED);
  if (soldierFist === undefined) throw new Error('setup: the AI fixture lost its fist');
  const fist = { ...soldierFist, typeId: CIVILIAN_FIST, id: 'viking_civilian_fist', jobType: CIVILIST };
  return { ...base, weapons: [...base.weapons, fist] };
}

function town(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(128, 96) });
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

function seat(sim: Simulation, computer: boolean): void {
  setAiControl(sim.world, ctxOf(sim), {
    kind: 'setAiControl',
    player: SEAT,
    enabled: true,
    ...(computer ? {} : { computerEnabled: false }),
  });
}

/** The enemy scout, stepped into the town with no tick between, so no soldier sees him before the decision. */
function scoutIn(sim: Simulation): Entity {
  const scout = spawn(sim, SCOUT, FAR_OFF.x, FAR_OFF.y, FOE);
  sim.world.add(scout, Position, positionOfNode(HQ_AT.x + INTRUDER_OFFSET, HQ_AT.y));
  return scout;
}

function decide(sim: Simulation): void {
  settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick: DEFENCE_TICK });
}

function onto(sim: Simulation, target: Entity): Entity[] {
  return [...sim.world.query(AttackOrder)].filter((e) => sim.world.get(e, AttackOrder).target === target);
}

describe('computer defence - answering unarmed offenders', () => {
  it('lets an enemy scout who only walks through the town go unanswered', () => {
    const { sim } = town();
    seat(sim, true);
    spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    spawn(sim, CIVILIST, HQ_AT.x + 2, HQ_AT.y + 6, SEAT);
    const scout = scoutIn(sim);

    decide(sim);

    expect(onto(sim, scout)).toEqual([]);
  });

  it('sends a free soldier at a scout who robbed it, leashed to the zone, and its people keep working', () => {
    const { sim } = town();
    seat(sim, true);
    const soldier = spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    const civilian = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    const scout = scoutIn(sim);
    noteOffence(sim.world, ctxOf(sim), scout, SEAT);

    decide(sim);

    expect(onto(sim, scout)).toEqual([soldier]);
    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
    // The leash reaches past the band the scout was answered inside, so the chase ends at the town's edge.
    expect(sim.world.get(soldier, AttackOrder).leash?.radius).toBeGreaterThan(
      threatWatchNodes(ctxOf(sim), VIKING),
    );
    // A second decision sends nobody more: the soldier already on him is counted.
    decide(sim);
    expect(onto(sim, scout)).toEqual([soldier]);
  });

  it('with no soldier, sends the civilians nearest the thief at him, two at most', () => {
    const { sim } = town();
    seat(sim, true);
    const scout = scoutIn(sim);
    const nearest = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    const next = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 4, HQ_AT.y, SEAT);
    const farther = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 6, HQ_AT.y, SEAT);
    noteOffence(sim.world, ctxOf(sim), scout, SEAT);

    decide(sim);

    expect(onto(sim, scout)).toEqual([nearest, next]);
    expect(onto(sim, scout)).toHaveLength(STRIKE_BACK_PARTY);
    expect(sim.world.has(farther, AttackOrder)).toBe(false);
  });

  it('leaves a seat closed to the computer as it was: no offender is kept, nobody is sent', () => {
    const { sim } = town();
    seat(sim, false);
    spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    const scout = scoutIn(sim);
    noteOffence(sim.world, ctxOf(sim), scout, SEAT);

    // Every tick of one interval, so the map AI's own decision slot comes round.
    for (let tick = 0; tick < COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick });
    }

    expect(onto(sim, scout)).toEqual([]);
  });
});
