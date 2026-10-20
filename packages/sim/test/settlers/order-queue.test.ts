import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  addCurrentAtomic,
  addPerson,
  Building,
  CurrentAtomic,
  DeferredOrder,
  Equipment,
  EquipOrder,
  JobAssignment,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  ORDER_QUEUE_LIMIT,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  Rider,
  SIGNPOST_SPACING_NODES,
  Signpost,
  Stockpile,
  setMissionBehaviour,
  stampOwner,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  cellAnchorNode,
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { queueBehindCurrentOrder, sendUnit } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** Shift-clicked orders wait behind the settler's current one and start the tick it ends. */

const VIKING = 1;
const WOODCUTTER = 1;
const SCOUT = 27; // fixture job 27 - allowatomic 43 only, like the original scout
const HUMAN_PLAYER = 0;
const EAT_ATOMIC = 10;
const EAT_TICKS = 5; // fixture `viking_eat` length
const WALK_BUDGET = 400;
const SLEEP_BUDGET = 4000;
const CARPENTER = 2;
const SAWMILL = 2; // fixture building type with one carpenter seat
const MEAD = 13; // fixture misc goods
const POTION_FOOD_SMALL = 14;

const MAP = { width: 48, height: 8 };

function freshSim(width = MAP.width, height = MAP.height): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(width, height) });
}

function ownedSettler(sim: Simulation, x: number, y: number, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function walk(e: Entity, cx: number, cy: number, queued = false): Command {
  const n = cellAnchorNode(cx, cy);
  return { kind: 'moveUnit', entity: e, x: n.hx, y: n.hy, ...(queued ? { queued } : {}) };
}

function standsAt(sim: Simulation, e: Entity, cx: number, cy: number): boolean {
  const p = sim.world.get(e, Position);
  return fx.toInt(p.x) === cx && fx.toInt(p.y) === cy && !sim.world.has(e, PlayerOrder);
}

/** Start a meal: a non-interruptible clip, as a need drive does. */
function eat(sim: Simulation, e: Entity): void {
  addCurrentAtomic(sim.world, e, {
    atomicId: EAT_ATOMIC,
    duration: EAT_TICKS,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
}

/** A Shift-clicked put-on of the misc good `goodType` from a pile, into misc slot `slot`. */
function queuedEquip(e: Entity, goodType: number, slot: number): Command {
  return { kind: 'equipGood', entity: e, group: 'misc', slot, goodType, skipReturn: true, queued: true };
}

function stepUntil(sim: Simulation, done: () => boolean, budget = WALK_BUDGET): void {
  for (let t = 0; t < budget && !done(); t++) sim.step();
}

describe('order queue', () => {
  it('a queued walk on a settler with no order applies at once', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2, true));
    sim.step();
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('walks the queued waypoints in order, starting each the tick the one ahead arrives', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders).toHaveLength(2);

    let reachedFirst = false;
    for (let t = 0; t < WALK_BUDGET && !standsAt(sim, e, 14, 5); t++) {
      sim.step();
      const p = sim.world.get(e, Position);
      if (fx.toInt(p.x) === 8 && fx.toInt(p.y) === 2) reachedFirst = true;
      // No tick between two legs leaves the settler without an order the planner could re-task.
      if (sim.world.has(e, OrderQueue)) expect(sim.world.has(e, PlayerOrder)).toBe(true);
    }
    expect(reachedFirst).toBe(true);
    expect(standsAt(sim, e, 14, 5)).toBe(true);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('an unqueued order drops every waiting one', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 14, 2));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    sim.enqueueSetup(walk(e, 2, 5));
    sim.step();
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    stepUntil(sim, () => standsAt(sim, e, 2, 5));
    expect(standsAt(sim, e, 2, 5)).toBe(true);
  });

  it('a workplace posting drops the queue, so the new worker stays at its post', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, null);
    const mill = sim.world.create();
    sim.world.add(mill, Position, { x: fx.fromInt(6), y: fx.fromInt(4) });
    sim.world.add(mill, Building, { buildingType: SAWMILL, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(mill, Owner, { player: HUMAN_PLAYER });
    sim.world.add(mill, Stockpile, { amounts: new Map() });
    sim.enqueueSetup(walk(e, 20, 2));
    sim.enqueueSetup(walk(e, 40, 5, true));
    sim.step();
    sim.enqueueSetup({
      kind: 'assignWorkerGroup',
      building: mill,
      members: [{ entity: e, jobPriority: [CARPENTER] }],
    });
    sim.step();
    expect(sim.world.get(e, JobAssignment).workplace).toBe(mill);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
  });

  it('a saved queue walks on the same after a restore', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.enqueueSetup(walk(e, 14, 5, true));
    sim.step();
    const copy = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: testContent(),
      map: grassMap(MAP.width, MAP.height),
    });
    expect(copy.world.get(e, OrderQueue).orders).toHaveLength(2);
    sim.run(WALK_BUDGET);
    copy.run(WALK_BUDGET);
    expect(copy.hashState()).toBe(sim.hashState());
    expect(standsAt(copy, e, 14, 5)).toBe(true);
  });

  it(`keeps at most ${ORDER_QUEUE_LIMIT} waiting orders`, () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 40, 2));
    for (let i = 0; i <= ORDER_QUEUE_LIMIT; i++) sim.enqueueSetup(walk(e, 3 + i, 5, true));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders).toHaveLength(ORDER_QUEUE_LIMIT);
  });

  it('parks the next leg behind a meal that took the settler off its walk', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(walk(e, 8, 5, true));
    sim.step();
    // A meal takes the settler off its walk, as a need drive does.
    sim.world.remove(e, PlayerOrder);
    sim.world.remove(e, MoveGoal);
    eat(sim, e);
    sim.step();
    expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.get(e, DeferredOrder).command.kind).toBe('moveUnit');
    expect(sim.world.get(e, CurrentAtomic).atomicId).toBe(EAT_ATOMIC);
    stepUntil(sim, () => standsAt(sim, e, 8, 5));
    expect(standsAt(sim, e, 8, 5)).toBe(true);
  });

  it("does not wait for the settler's own doings: work or a breach of its own", () => {
    const sim = freshSim();
    const busy = ownedSettler(sim, 2, 2, WOODCUTTER);
    eat(sim, busy); // a non-interruptible clip with no order behind it
    const breaker = ownedSettler(sim, 2, 4, WOODCUTTER);
    sim.world.add(breaker, AttackOrder, {
      target: busy,
      breach: { resume: null, stand: null, enemy: busy },
    });
    for (const e of [busy, breaker]) sim.enqueueSetup(walk(e, 12, 3, true));
    sim.step();
    for (const e of [busy, breaker]) expect(sim.world.has(e, OrderQueue)).toBe(false);
    expect(sim.world.get(busy, DeferredOrder).command.kind).toBe('moveUnit'); // parked as a plain click is
    expect(sim.world.has(breaker, PlayerOrder)).toBe(true);
  });

  it('a queued sleep waits for the walk ahead, and the next walk waits for the sleep', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup({ kind: 'orderNeed', entity: e, need: 'fatigue', queued: true });
    sim.enqueueSetup(walk(e, 14, 2, true));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders.map((order) => order.kind)).toEqual(['orderNeed', 'moveUnit']);
    stepUntil(sim, () => sim.world.has(e, NeedOrder));
    expect(fx.toInt(sim.world.get(e, Position).x)).toBe(8);
    expect(sim.world.get(e, OrderQueue).orders.map((order) => order.kind)).toEqual(['moveUnit']);
    let slept = false;
    stepUntil(
      sim,
      () => {
        slept ||= sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
        return sim.world.has(e, PlayerOrder);
      },
      SLEEP_BUDGET,
    );
    expect(slept).toBe(true);
    expect(sim.world.has(e, NeedOrder)).toBe(false);
    stepUntil(sim, () => standsAt(sim, e, 14, 2));
    expect(standsAt(sim, e, 14, 2)).toBe(true);
  });

  it('refuses a need order for a jobless settler, which nothing would answer, so its Shift walk goes', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, null);
    sim.enqueueSetup({ kind: 'orderNeed', entity: e, need: 'hunger' });
    sim.enqueueSetup(walk(e, 12, 3, true));
    sim.step();
    expect(sim.world.has(e, NeedOrder)).toBe(false);
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
  });

  it('a queued need order starts at once on a settler standing idle, not on its next re-plan beat', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.world.add(e, NeedOrder, { need: 'hunger' }); // no food anywhere on the map
    sim.enqueueSetup({ kind: 'orderNeed', entity: e, need: 'fatigue', queued: true });
    stepUntil(sim, () => sim.world.tryGet(e, NeedOrder)?.need === 'fatigue');
    sim.step();
    const answering = sim.world.has(e, CurrentAtomic) || sim.world.has(e, MoveGoal);
    expect(answering).toBe(true);
  });

  it('a settler handed to another player drops the orders its old owner queued', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.enqueueSetup(walk(e, 20, 2));
    sim.enqueueSetup(walk(e, 20, 5, true));
    sim.step();
    stampOwner(sim.world, e, HUMAN_PLAYER + 1);
    sim.step();
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('a waiting need order nothing answers gives way to the next queued order', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.world.add(e, NeedOrder, { need: 'hunger' }); // no food anywhere on the map
    sim.enqueueSetup(walk(e, 12, 3, true));
    sim.step();
    expect(sim.world.has(e, NeedOrder)).toBe(false);
    expect(sim.world.has(e, OrderQueue)).toBe(true);
    sim.step();
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('drops the queue on a work flag, a script walk and a script taking the unit', () => {
    const sim = freshSim();
    const flagged = ownedSettler(sim, 2, 2, WOODCUTTER);
    const sent = ownedSettler(sim, 2, 4, WOODCUTTER);
    const locked = ownedSettler(sim, 2, 6, WOODCUTTER);
    for (const e of [flagged, sent, locked]) {
      sim.enqueueSetup(walk(e, 20, 2));
      sim.enqueueSetup(walk(e, 20, 5, true));
    }
    sim.step();
    const flag = cellAnchorNode(4, 2);
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: flagged, x: flag.hx, y: flag.hy });
    sendUnit(sim.world, ctxOf(sim), sent, flag.hx, flag.hy);
    setMissionBehaviour(sim.world, locked, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
    sim.step();
    for (const e of [flagged, sent, locked]) expect(sim.world.has(e, OrderQueue)).toBe(false);
  });

  it('a rider never queues: its walk orders drive or leave the vehicle at once', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.world.add(e, PlayerOrder, {});
    sim.world.add(e, Rider, { vehicle: e, boarding: false, leaving: null });
    const n = cellAnchorNode(8, 2);
    expect(
      queueBehindCurrentOrder(sim.world, { kind: 'moveUnit', entity: e, x: n.hx, y: n.hy, queued: true }),
    ).toBe(false);
  });

  it('a scout erects a queued chain of signposts one after another', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    const spots = [8, 8 + SIGNPOST_SPACING_NODES, 8 + 2 * SIGNPOST_SPACING_NODES];
    spots.forEach((x, i) => {
      sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x, y: 4, ...(i > 0 ? { queued: true } : {}) });
    });
    stepUntil(sim, () => [...sim.world.query(Signpost)].length === spots.length, 3 * WALK_BUDGET);
    const posts = [...sim.world.query(Signpost)].map((post) => fx.toInt(sim.world.get(post, Position).x));
    expect(posts).toEqual(spots.map((x) => x / 2));
  });

  it('the placement overlay keeps the spacing of the posts the scout walks to and has queued', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    const ROW = 4;
    const area = { minHx: 0, maxHx: 95, minHy: ROW, maxHy: ROW };
    const accepts = (hx: number): boolean => sim.signpostAnswer(HUMAN_PLAYER, area)?.accepted[hx] === 1;
    const FIRST = 20;
    const QUEUED = FIRST + SIGNPOST_SPACING_NODES;
    const FREE = QUEUED + SIGNPOST_SPACING_NODES;
    expect(accepts(FIRST + 1)).toBe(true);
    const before = sim.signpostBlockerVersion();

    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: FIRST, y: ROW });
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: QUEUED, y: ROW, queued: true });
    sim.step();

    expect(sim.signpostBlockerVersion()).not.toBe(before);
    expect(accepts(FIRST + 1)).toBe(false); // the errand under way
    expect(accepts(QUEUED + 1)).toBe(false); // the queued post
    expect(accepts(FREE)).toBe(true);
    // The erect command judges standing posts only: a plan holds no ground against an order.
    expect(sim.signpostProbe(HUMAN_PLAYER)?.canPlace(QUEUED + 1, ROW)).toBe(true);
  });

  it('a queued signpost the spot no longer takes is skipped for the next order', () => {
    const sim = freshSim(96, 8);
    const scout = ownedSettler(sim, 2, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    // Inside the first post's spacing once it stands.
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 12, y: 4, queued: true });
    sim.enqueueSetup(walk(scout, 20, 2, true));
    stepUntil(sim, () => standsAt(sim, scout, 20, 2) && !sim.world.has(scout, OrderQueue), 2 * WALK_BUDGET);
    expect(standsAt(sim, scout, 20, 2)).toBe(true);
    expect([...sim.world.query(Signpost)]).toHaveLength(1);
  });

  it('queued put-ons wait for the walk ahead, then fill their own misc slots one after another', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    const pile = sim.world.create();
    sim.world.add(pile, Position, { x: fx.fromInt(14), y: fx.fromInt(5) });
    sim.world.add(pile, Stockpile, {
      amounts: new Map([
        [MEAD, 1],
        [POTION_FOOD_SMALL, 1],
      ]),
    });
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup(queuedEquip(e, MEAD, 0));
    sim.enqueueSetup(queuedEquip(e, POTION_FOOD_SMALL, 1));
    sim.step();
    expect(sim.world.get(e, OrderQueue).orders.map((order) => order.kind)).toEqual([
      'equipGood',
      'equipGood',
    ]);
    expect(sim.world.has(e, EquipOrder)).toBe(false);

    stepUntil(sim, () => sim.world.has(e, EquipOrder));
    expect(fx.toInt(sim.world.get(e, Position).x)).toBe(8);
    stepUntil(sim, () => !sim.world.has(e, EquipOrder) && !sim.world.has(e, OrderQueue), 2 * WALK_BUDGET);
    expect(sim.world.get(e, Equipment).misc.map((good) => good?.goodType ?? null)).toEqual([
      MEAD,
      POTION_FOOD_SMALL,
      null,
      null,
    ]);
  });

  it('a queued attack-move marches after the walk ahead of it', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2, WOODCUTTER);
    const n = cellAnchorNode(14, 2);
    sim.enqueueSetup(walk(e, 8, 2));
    sim.enqueueSetup({ kind: 'attackMoveUnit', entity: e, x: n.hx, y: n.hy, queued: true });
    sim.step();
    expect(sim.world.get(e, PlayerOrder).attackMove).toBeUndefined();
    stepUntil(sim, () => sim.world.tryGet(e, PlayerOrder)?.attackMove !== undefined);
    expect(fx.toInt(sim.world.get(e, Position).x)).toBe(8);
    expect(sim.world.has(e, OrderQueue)).toBe(false);
  });
});
