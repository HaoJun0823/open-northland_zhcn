import type { MapAiSeat } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiOrder,
  Building,
  COMPUTER_MODULE_IDS,
  computerModuleEnables,
  diplomacyStance,
  Engagement,
  MapAiState,
  type MapAiStateData,
  MISSION_BEHAVIOUR,
  mapAiEntity,
  Owner,
  Person,
  Position,
  Settler,
  Stance,
  setAiExternalFlag,
  setDiplomacyStance,
  stampMissionBehaviour,
} from '../../src/components/index.js';
import { aiCommand } from '../../src/core/commands/index.js';
import type { DeepReadonly, Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { hexDistanceBetween, nodeOfPosition } from '../../src/nav/halfcell.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-shared/cadence.js';
import { mapAiSoldierClaims } from '../../src/systems/ai-shared/military/ownership.js';
import { commandSystem } from '../../src/systems/command/index.js';
import { CONDITION_ALWAYS } from '../../src/systems/map-ai/index.js';
import { mapAiSystem } from '../../src/systems/map-ai/system.js';
import { setAiControl } from '../../src/systems/orders/ai.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The scripted handler's program end to end: a Defend post gathers a seat's soldiers and guards them
 * there, a CreateCreatures task spawns on its condition, a seat with no program of its own defends its
 * centre, and the state survives a save.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const SPEARMAN = 32;
const MAP = 128;
/** Two rounds after the seat's turn: the assignment lands on an even turn, the walk order on the next. */
const TWO_TURNS = 2 * AI_HANDLER_ROUND_TICKS + 1;
/** Long enough for the men to walk across the fixture map. */
const WALK_TICKS = 900;

const POST = { x: 90, y: 90, range: 20 };
const SPAWN = { x: 20, y: 20 };

function seatRow(rows: Partial<MapAiSeat>): MapAiSeat {
  return {
    player: SEAT,
    allDisabled: false,
    computerDisabled: false,
    disabledComputerModules: ['military'],
    conditions: [],
    tasks: [],
    ...rows,
  };
}

function simWith(script: readonly MapAiSeat[]): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: grassNodeMap(MAP, MAP),
    mapAiScript: script,
  });
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: false } });
  return sim;
}

function spawn(
  sim: Simulation,
  count: number,
  at: { x: number; y: number },
  jobType = SPEARMAN,
  owner = SEAT,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.x + 2 * i, y: at.y, tribe: VIKING, owner });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner = SEAT): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error(`setup: building ${buildingType} was refused`);
  return placed;
}

function programOf(sim: Simulation): DeepReadonly<MapAiStateData> {
  const carrier = mapAiEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('the seat runs no program');
  return sim.world.get(carrier, MapAiState);
}

function pointOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const at = sim.world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}

describe('ai program - a Defend post', () => {
  it('gathers the seat’s soldiers within half the post’s range and guards them there', () => {
    const sim = simWith([
      seatRow({
        tasks: [{ kind: 'defend', priority: 10, condition: CONDITION_ALWAYS, ...POST, min: 0, max: 0 }],
      }),
    ]);
    const band = spawn(sim, 3, SPAWN);
    sim.run(TWO_TURNS + WALK_TICKS);
    for (const e of band) {
      const at = pointOf(sim, e);
      expect(hexDistanceBetween(at.hx, at.hy, POST.x, POST.y)).toBeLessThan(POST.range / 2 + 2);
      expect(sim.world.get(e, Stance).mode).toBe(MILITARY_MODE.DEFEND);
    }
    const program = programOf(sim);
    expect(program.soldiers.map((s) => s.task)).toEqual([0, 0, 0]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('leaves a man the map put beyond the player’s control where he stands, off the list', () => {
    const sim = simWith([
      seatRow({
        tasks: [{ kind: 'defend', priority: 10, condition: CONDITION_ALWAYS, ...POST, min: 0, max: 0 }],
      }),
    ]);
    const [listed, fixed] = spawn(sim, 2, SPAWN);
    if (listed === undefined || fixed === undefined) throw new Error('setup: the spawn was refused');
    stampMissionBehaviour(sim.world, fixed, MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
    sim.run(TWO_TURNS + WALK_TICKS);
    expect(programOf(sim).soldiers.map((s) => s.entity)).toEqual([listed]);
    const at = pointOf(sim, fixed);
    expect(hexDistanceBetween(at.hx, at.hy, SPAWN.x, SPAWN.y)).toBeLessThan(4);
  });

  it('holds a post only while its condition holds, and lets the men go when it stops', () => {
    const FLAG = 2;
    const sim = simWith([
      seatRow({
        conditions: [{ kind: 'onExternal', slot: FLAG, raised: false }],
        tasks: [{ kind: 'defend', priority: 10, condition: FLAG, ...POST, min: 0, max: 0 }],
      }),
    ]);
    const band = spawn(sim, 2, SPAWN);
    sim.run(TWO_TURNS);
    const program = (): { task: number | null; onDefault: boolean }[] =>
      programOf(sim).soldiers.map((s) => ({ task: s.task, onDefault: s.onDefault }));
    // No post is active: the men hold the default position the handler made at the seat's centre.
    expect(program()).toEqual(band.map(() => ({ task: null, onDefault: true })));
    setAiExternalFlag(sim.world, SEAT, FLAG, true);
    sim.run(TWO_TURNS);
    expect(program()).toEqual(band.map(() => ({ task: 0, onDefault: false })));
    setAiExternalFlag(sim.world, SEAT, FLAG, false);
    sim.run(TWO_TURNS);
    expect(program()).toEqual(band.map(() => ({ task: null, onDefault: true })));
  });
});

describe('ai program - CreateCreatures', () => {
  it('spawns its creatures on every recheck that finds its condition holding, and once when told so', () => {
    const FLAG = 2;
    const ONCE = 3;
    const sim = simWith([
      seatRow({
        conditions: [
          { kind: 'onExternal', slot: FLAG, raised: false },
          { kind: 'onExternal', slot: ONCE, raised: true },
        ],
        tasks: [
          {
            kind: 'createCreatures',
            priority: 100,
            condition: FLAG,
            tribe: VIKING,
            job: SPEARMAN,
            ...SPAWN,
            missionId: 0,
            count: 2,
            once: false,
          },
          {
            kind: 'createCreatures',
            priority: 100,
            condition: ONCE,
            tribe: VIKING,
            job: SPEARMAN,
            x: SPAWN.x + 10,
            y: SPAWN.y,
            missionId: 7,
            count: 1,
            once: true,
          },
        ],
      }),
    ]);
    const soldiers = (): number =>
      [...sim.world.query(Person, Owner)].filter((e) => sim.world.get(e, Owner).player === SEAT).length;
    sim.run(AI_HANDLER_ROUND_TICKS);
    // The once-only task ran on the first turn; the flagged one waits for its flag.
    expect(soldiers()).toBe(1);
    setAiExternalFlag(sim.world, SEAT, FLAG, true);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(soldiers()).toBe(3);
    // Holding the flag changes nothing; a recheck comes with a changed slot.
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(soldiers()).toBe(3);
    setAiExternalFlag(sim.world, SEAT, FLAG, false);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(soldiers()).toBe(3);
    setAiExternalFlag(sim.world, SEAT, FLAG, true);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(soldiers()).toBe(5);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('ai program - the seat’s own defaults', () => {
  it('defends its own centre when the map authored no task, sending the men in at the centre’s Defend', () => {
    const sim = simWith([]);
    const CENTRE = { x: 60, y: 60 };
    place(sim, HQ_TYPE, CENTRE);
    const band = spawn(sim, 2, SPAWN);
    sim.run(TWO_TURNS + WALK_TICKS);
    const program = programOf(sim);
    expect(program.defaultDefend).not.toBeNull();
    expect(program.defaultPosition?.range).toBe(15);
    for (const e of band) {
      const at = pointOf(sim, e);
      expect(hexDistanceBetween(at.hx, at.hy, CENTRE.x, CENTRE.y)).toBeLessThan(40 / 2 + 4);
    }
  });

  it('keeps an authored default position on the map, and takes the centre for one in the border band', () => {
    const CENTRE = { x: 60, y: 60 };
    const authored = simWith([seatRow({ defaultPosition: { x: 40, y: 44, range: 30 } })]);
    place(authored, HQ_TYPE, CENTRE);
    spawn(authored, 1, SPAWN);
    authored.run(TWO_TURNS);
    expect(programOf(authored).defaultPosition).toEqual({ hx: 40, hy: 44, range: 30 });

    const offMap = simWith([seatRow({ defaultPosition: { x: 0, y: 0, range: 9000 } })]);
    const hq = place(offMap, HQ_TYPE, CENTRE);
    spawn(offMap, 1, SPAWN);
    offMap.run(TWO_TURNS);
    expect(programOf(offMap).defaultPosition).toEqual({ ...pointOf(offMap, hq), range: 15 });
  });

  it('runs nothing for a seat the map AI_Disabled, though its soldiers stay a computer seat’s', () => {
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: grassNodeMap(MAP, MAP),
      mapAiScript: [seatRow({ allDisabled: true })],
    });
    sim.enqueueSetup({
      kind: 'setAiControl',
      player: SEAT,
      enabled: true,
      mapAiEnabled: false,
      modules: { military: false },
    });
    spawn(sim, 1, SPAWN);
    sim.run(TWO_TURNS);
    expect(mapAiEntity(sim.world, SEAT)).toBeNull();
  });

  it('runs map tasks alongside autonomous military, but never for a human seat', () => {
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: grassNodeMap(MAP, MAP),
      mapAiScript: [seatRow({})],
    });
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    spawn(sim, 1, SPAWN);
    spawn(sim, 1, SPAWN, SPEARMAN, FOE);
    sim.run(TWO_TURNS);
    expect(mapAiEntity(sim.world, SEAT)).not.toBeNull();
    expect(mapAiEntity(sim.world, FOE)).toBeNull();
  });
});

describe('ai program - one-shots and saves', () => {
  it('changes the seat’s diplomacy once and keeps its program through a save', () => {
    const sim = simWith([
      seatRow({
        conditions: [{ kind: 'onTime', slot: 0, ticks: AI_HANDLER_ROUND_TICKS }],
        tasks: [{ kind: 'changeDiplomacy', priority: 5, condition: 0, player: FOE, state: 3 }],
      }),
    ]);
    setDiplomacyStance(sim.world, SEAT, FOE, 'friend');
    spawn(sim, 1, SPAWN);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, SEAT, FOE)).toBe('friend');
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, SEAT, FOE)).toBe('enemy');
    setDiplomacyStance(sim.world, SEAT, FOE, 'neutral');
    // Neutral back, so the seat's diplomacy answer has nothing to turn and only a repeat could move it.
    setDiplomacyStance(sim.world, FOE, SEAT, 'neutral');
    sim.run(2 * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, SEAT, FOE)).toBe('neutral');

    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: sim.content,
      map: grassNodeMap(MAP, MAP),
      ...(sim.mapAiScript !== undefined ? { mapAiScript: sim.mapAiScript } : {}),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(programOf(restored).tasks).toEqual([{ done: true, priority: 0 }]);
    const restoredWith = (rows: Partial<MapAiSeat> | null): (() => Simulation) => {
      return () =>
        restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
          content: sim.content,
          map: grassNodeMap(MAP, MAP),
          ...(rows === null ? {} : { mapAiScript: [seatRow(rows)] }),
        });
    };
    // No script, a script with another slot count, and one with fewer tasks all fit the records badly.
    expect(restoredWith(null)).toThrow(/AI program/);
    expect(
      restoredWith({
        conditions: [{ kind: 'onTime', slot: 1, ticks: AI_HANDLER_ROUND_TICKS }],
        tasks: [{ kind: 'changeDiplomacy', priority: 5, condition: 1, player: FOE, state: 3 }],
      }),
    ).toThrow(/AI program/);
    expect(
      restoredWith({ conditions: [{ kind: 'onTime', slot: 0, ticks: AI_HANDLER_ROUND_TICKS }], tasks: [] }),
    ).toThrow(/AI program/);
  });
});

describe('map AI and autonomous military ownership', () => {
  it.each([false, true])('reclaims its unchanged task after being disabled (engaged: %s)', (engaged) => {
    const sim = simWith([
      seatRow({
        tasks: [{ kind: 'defend', priority: 10, condition: CONDITION_ALWAYS, ...POST, min: 0, max: 0 }],
      }),
    ]);
    const [soldier] = spawn(sim, 1, SPAWN);
    if (soldier === undefined) throw new Error('missing soldier');
    const ctx = { ...ctxOf(sim), tick: 6, mapAiScript: sim.mapAiScript ?? [] };
    mapAiSystem(sim.world, ctx);
    commandSystem(sim.world, ctx);
    expect(programOf(sim).soldiers[0]?.task).toBe(0);
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: SEAT, enabled: true, mapAiEnabled: false });
    sim.commands.enqueue(
      aiCommand(SEAT, { kind: 'attackMoveUnit', entity: soldier, x: 110, y: 20 }, 'military'),
    );
    commandSystem(sim.world, ctx);
    if (engaged) sim.world.add(soldier, Engagement, { repathAt: ctx.tick });
    expect(sim.world.get(soldier, AiOrder).source).toBe('military');
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: SEAT, enabled: true });
    const next = { ...ctx, tick: 126 };
    mapAiSystem(sim.world, next);
    commandSystem(sim.world, next);
    expect(programOf(sim).soldiers[0]?.task).toBe(0);
    expect(sim.world.get(soldier, AiOrder).source).toBe('map-ai');
    expect(sim.world.has(soldier, Engagement)).toBe(false);
  });

  it('reserves an authored band, leaves the rest to the computer, and releases the band when its condition ends', () => {
    const FLAG = 2;
    const sim = simWith([
      seatRow({
        conditions: [{ kind: 'onExternal', slot: FLAG, raised: true }],
        tasks: [{ kind: 'defend', priority: 10, condition: FLAG, ...POST, min: 2, max: 2 }],
      }),
    ]);
    place(sim, 12, { x: 16, y: 20 });
    place(sim, HQ_TYPE, { x: 112, y: 20 }, FOE);
    const soldiers = spawn(sim, 6, { x: 20, y: 30 });
    const modules = computerModuleEnables();
    for (const id of COMPUTER_MODULE_IDS) modules[id] = id === 'military';
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules });
    sim.run(TWO_TURNS);

    const reserved = mapAiSoldierClaims(sim.world, SEAT);
    expect(reserved.size).toBe(2);
    expect([...reserved].every((entity) => sim.world.tryGet(entity, AiOrder)?.source === 'map-ai')).toBe(
      true,
    );
    expect(programOf(sim).soldiers.filter((record) => record.onDefault)).toEqual([]);
    const autonomousOrders = sim.commands.log
      .flatMap((entry) =>
        entry.origin === 'ai' && entry.decisionSource === 'military' && 'entity' in entry.command
          ? [entry.command.entity]
          : [],
      )
      .filter((entity) => soldiers.includes(entity));
    expect(autonomousOrders.length).toBeGreaterThan(0);
    expect(autonomousOrders.every((entity) => !reserved.has(entity))).toBe(true);

    setAiExternalFlag(sim.world, SEAT, FLAG, false);
    sim.run(TWO_TURNS);
    expect(mapAiSoldierClaims(sim.world, SEAT).size).toBe(0);
    expect([...reserved].every((entity) => sim.world.tryGet(entity, AiOrder)?.source !== 'map-ai')).toBe(
      true,
    );
    expect(programOf(sim).soldiers.every((record) => record.task === null && !record.onDefault)).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('keeps authored one-shot tasks active while autonomous military is enabled', () => {
    const sim = simWith([
      seatRow({
        tasks: [{ kind: 'changeDiplomacy', priority: 5, condition: CONDITION_ALWAYS, player: FOE, state: 3 }],
      }),
    ]);
    setDiplomacyStance(sim.world, SEAT, FOE, 'friend');
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: true } });
    spawn(sim, 1, SPAWN);
    sim.run(TWO_TURNS);
    expect(programOf(sim).tasks[0]?.done).toBe(true);
    expect(diplomacyStance(sim.world, SEAT, FOE)).toBe('enemy');
  });
});

it('restores the implicit home guard when military planning stops and releases it when planning resumes', () => {
  const sim = simWith([seatRow({})]);
  const band = spawn(sim, 2, SPAWN);
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: true } });
  sim.run(TWO_TURNS);
  expect(programOf(sim).defaultDefend).not.toBeNull();
  expect(programOf(sim).tasks).toEqual([]);
  expect(programOf(sim).soldiers.every((record) => record.task === null)).toBe(true);

  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: false } });
  sim.run(TWO_TURNS);
  expect(programOf(sim).tasks).toHaveLength(1);
  expect(programOf(sim).soldiers.map((record) => record.task)).toEqual(band.map(() => 0));

  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: true } });
  sim.run(TWO_TURNS);
  expect(programOf(sim).tasks).toEqual([]);
  expect(programOf(sim).soldiers.every((record) => record.task === null && !record.onDefault)).toBe(true);
});
