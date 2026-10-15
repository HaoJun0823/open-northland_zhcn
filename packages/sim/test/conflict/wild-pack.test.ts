import { describe, expect, it } from 'vitest';
import {
  Anger,
  addCurrentAtomic,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Frightened,
  Health,
  HerdMember,
  MISSION_BEHAVIOUR,
  Settler,
  StayPoint,
  stampMissionBehaviour,
  UnreachableTargets,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  ANIMAL_ACQUIRE_RANGE_NODES,
  ANIMAL_AGGRO_RADIUS_NODES,
  isFleeThreat,
} from '../../src/systems/conflict/targeting.js';
import { atomicSystem, cleanupSystem, combatSystem, herdingSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { KIN_ALARM_RADIUS_NODES } from '../../src/systems/settlers/atomics/effects/combat/hit/reactions.js';
import { hexNodeDistance } from '../../src/systems/spatial/metric.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { fleeCheckCtxOf, nextTickCtxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { wildAt } from '../fixtures/wildlife.js';
import {
  ATTACK_ATOMIC,
  BEAR,
  BOAR,
  ctxOf,
  fighterAtNode,
  grassMap,
  VIKING,
  WOODCUTTER,
} from './combat-system/support.js';
import { combatantAtNode, P0 } from './stances/support.js';

// Wild packs: the fixture BEAR is aggressive with a reach of 2 map points and follows a leader; the BOAR
// fights only once struck. Every animal here stands on row 0 of the half-cell lattice, where one node
// step is one map point.

/** `soldier_unarmed`, a fighter job in the fixture content. */
const SOLDIER = 31;

function mapTerrain(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped fixture expected');
  return terrain;
}

/** An animal of `tribe` at node (hx, 0), anchored where it stands unless `stayAt` names another node. */
function animalAt(sim: Simulation, tribe: number, hx: number, stayAt = hx): Entity {
  const e = fighterAtNode(sim, hx, 0, tribe, null);
  sim.world.add(e, StayPoint, { cell: mapTerrain(sim).nodeAt(stayAt, 0) });
  return e;
}

function joinHerd(sim: Simulation, leader: Entity, ...followers: Entity[]): void {
  sim.world.add(leader, HerdMember, { leader });
  for (const f of followers) sim.world.add(f, HerdMember, { leader });
}

function swingTarget(sim: Simulation, e: Entity): number | undefined {
  const effect = sim.world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'attack' ? effect.target : undefined;
}

/** Queue a swing of `striker` at `target` that lands on the next atomic pass. */
function strike(sim: Simulation, striker: Entity, target: Entity): void {
  addCurrentAtomic(sim.world, striker, {
    atomicId: ATTACK_ATOMIC,
    duration: 1,
    effect: { kind: 'attack', target, damage: 50 },
    targetEntity: target,
    targetTile: null,
  });
}

function node(sim: Simulation, hx: number): NodeId {
  return mapTerrain(sim).nodeAt(hx, 0);
}

/** How far `e` stands from node (hx, 0), in map points. */
function pointsFrom(sim: Simulation, e: Entity, hx: number): number {
  return hexNodeDistance(mapTerrain(sim), node(sim, hx), entityNode(sim.world, mapTerrain(sim), e));
}

/** An anger that outlasts the walk to the leash and well past it, in ticks. */
const LONG_ANGER_TICKS = 400;
/** A stretch of the anger after the leash, and how far home a walking boar gets in it, in map points. */
const HOMEWARD_TICKS = 80;
const HOMEWARD_MIN_POINTS = 4;

/** A landscape type that walls its one node off, and the test content's wood good it is built of. */
const WALL_POST = 691;
const WOOD = 5;
const WALL_HITPOINTS = 100;

/** An all-grass node map of `size` x `size` that knows the {@link WALL_POST} type. */
function postMap(size: number): Simulation {
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(size, size),
      landscapes: {
        placements: [],
        types: [
          {
            typeId: WALL_POST,
            walk: [{ dx: 0, dy: 0 }],
            build: [{ dx: 0, dy: 0 }],
            groups: [],
            wall: {
              maxHitpoints: WALL_HITPOINTS,
              repairPerStrike: 1,
              construction: [{ goodType: WOOD, amount: 1 }],
            },
          },
        ],
      },
    },
  });
}

describe('wild pack targeting', () => {
  it("a reaped leader's pack fights on under the lowest-id survivor", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = animalAt(sim, BEAR, 6);
    const first = animalAt(sim, BEAR, 8);
    const second = animalAt(sim, BEAR, 10);
    joinHerd(sim, leader, first, second);
    const viking = fighterAtNode(sim, 12, 0, VIKING, WOODCUTTER);

    sim.world.mut(leader, Health).hitpoints = 0;
    cleanupSystem(sim.world, ctxOf(sim));
    herdingSystem(sim.world, ctxOf(sim));
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(leader)).toBe(false);
    // The new leader finds the viking 4 points off its stay point and closes; the other copies it and,
    // already in reach, swings.
    expect(sim.world.get(first, Engagement).target).toBe(viking);
    expect(swingTarget(sim, second)).toBe(viking);
  });

  it("a struck boar's herd turns on the attacker, leader and all, instead of running", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const leader = fighterAtNode(sim, 2, 0, BOAR, null);
    const follower = fighterAtNode(sim, 4, 0, BOAR, null);
    for (const e of [leader, follower]) sim.world.add(e, StayPoint, { cell: node(sim, 2) });
    joinHerd(sim, leader, follower);
    const viking = fighterAtNode(sim, 6, 0, VIKING, WOODCUTTER);
    strike(sim, viking, follower);

    atomicSystem(sim.world, nextTickCtxOf(sim)); // the blow lands and provokes the follower
    combatSystem(sim.world, ctxOf(sim));

    expect(swingTarget(sim, follower)).toBe(viking);
    // The alarm provoked the leader too: it takes the striker rather than stampeding.
    expect(sim.world.has(leader, Anger)).toBe(true);
    expect(sim.world.has(leader, Frightened)).toBe(false);
    expect(sim.world.get(leader, Engagement).target).toBe(viking);
  });

  it('a struck leader takes its attacker though the attacker stands off its search circle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const stay = 40;
    const leader = animalAt(sim, BEAR, 10, stay);
    const follower = animalAt(sim, BEAR, 12, stay);
    joinHerd(sim, leader, follower);
    const viking = fighterAtNode(sim, 8, 0, VIKING, WOODCUTTER);
    expect(hexNodeDistance(mapTerrain(sim), node(sim, 8), node(sim, stay))).toBeGreaterThan(
      ANIMAL_AGGRO_RADIUS_NODES,
    );
    strike(sim, viking, leader);

    atomicSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.get(leader, Engagement).target).toBe(viking);
    expect(sim.world.get(follower, Engagement).target).toBe(viking);
  });

  it('a blow alarms the kin within 20 map points of the struck animal, and no farther', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const struck = animalAt(sim, BEAR, 2);
    const near = animalAt(sim, BEAR, 2 + KIN_ALARM_RADIUS_NODES);
    const far = animalAt(sim, BEAR, 3 + KIN_ALARM_RADIUS_NODES);
    const otherKind = animalAt(sim, BOAR, 6);
    const viking = fighterAtNode(sim, 0, 0, VIKING, WOODCUTTER);
    strike(sim, viking, struck);

    atomicSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.get(struck, Engagement).target).toBe(viking);
    expect(sim.world.get(near, Engagement).target).toBe(viking);
    expect(sim.world.has(far, Engagement)).toBe(false);
    expect(sim.world.has(otherKind, Engagement)).toBe(false);
    expect(sim.world.has(otherKind, Anger)).toBe(false);
  });

  it('a struck follower whose leader flees takes no target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const leader = fighterAtNode(sim, 2, 0, BOAR, null);
    const follower = fighterAtNode(sim, 4, 0, BOAR, null);
    joinHerd(sim, leader, follower);
    sim.world.add(leader, Frightened, { from: node(sim, 6), dest: null });
    const viking = fighterAtNode(sim, 6, 0, VIKING, WOODCUTTER);
    strike(sim, viking, follower);

    atomicSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.tryGet(follower, Engagement)?.target).toBeUndefined();
  });

  it('an attack in reach runs on however far from the stay point it stands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 1) });
    const hx = ANIMAL_ACQUIRE_RANGE_NODES + 10;
    const leader = animalAt(sim, BEAR, hx - 2, 0);
    const follower = animalAt(sim, BEAR, hx, 0);
    joinHerd(sim, leader, follower);
    const viking = fighterAtNode(sim, hx + 2, 0, VIKING, WOODCUTTER); // inside the follower's reach
    sim.world.add(leader, Engagement, { repathAt: 0, target: viking });
    sim.world.add(follower, Engagement, { repathAt: 0, target: viking });

    combatSystem(sim.world, ctxOf(sim));

    expect(swingTarget(sim, follower)).toBe(viking);
    expect(sim.world.get(leader, Engagement).target).toBe(viking);
  });

  it('a leader farther than 40 points from its stay point takes up no new target', () => {
    const run = (hx: number) => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 1) });
      const bear = animalAt(sim, BEAR, hx, 0);
      joinHerd(sim, bear);
      fighterAtNode(sim, hx + 2, 0, VIKING, WOODCUTTER);
      combatSystem(sim.world, ctxOf(sim));
      return sim.world.has(bear, Engagement);
    };
    // Within the acquisition gate the search circle still reaches the man two points past the bear.
    expect(run(ANIMAL_AGGRO_RADIUS_NODES - 2)).toBe(true);
    expect(run(ANIMAL_ACQUIRE_RANGE_NODES + 1)).toBe(false);
  });

  it('a provoked animal whose anger lapses fights its running attack to the end', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const boar = animalAt(sim, BOAR, 2);
    joinHerd(sim, boar);
    const viking = fighterAtNode(sim, 3, 0, VIKING, WOODCUTTER);
    sim.world.add(boar, Anger, { until: sim.tick }); // lapsed this very tick
    sim.world.add(boar, Engagement, { repathAt: 0, target: viking });

    combatSystem(sim.world, ctxOf(sim));

    expect(swingTarget(sim, boar)).toBe(viking);
  });

  it('a leader takes up a soldier before a nearer civilian, nearest to its stay point within a tier', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const bear = animalAt(sim, BEAR, 10);
    joinHerd(sim, bear);
    fighterAtNode(sim, 12, 0, VIKING, WOODCUTTER);
    fighterAtNode(sim, 22, 0, VIKING, SOLDIER);
    const nearSoldier = fighterAtNode(sim, 16, 0, VIKING, SOLDIER);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, Engagement).target).toBe(nearSoldier);
  });

  it('a leader searches around its stay point and takes the enemy nearest it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const stay = 30;
    const bear = animalAt(sim, BEAR, 10, stay);
    joinHerd(sim, bear);
    fighterAtNode(sim, 4, 0, VIKING, WOODCUTTER); // beside the bear, but off the stay point's circle
    fighterAtNode(sim, 13, 0, VIKING, WOODCUTTER); // nearer the bear than the pick
    const nearStay = fighterAtNode(sim, 44, 0, VIKING, WOODCUTTER);
    const terrain = mapTerrain(sim);
    expect(hexNodeDistance(terrain, node(sim, 4), node(sim, stay))).toBeGreaterThan(
      ANIMAL_AGGRO_RADIUS_NODES,
    );
    expect(hexNodeDistance(terrain, node(sim, 44), node(sim, stay))).toBeLessThan(
      hexNodeDistance(terrain, node(sim, 13), node(sim, stay)),
    );

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, Engagement).target).toBe(nearStay);
  });

  it('a leader passes over a man the map made invulnerable or hid from animals', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const bear = animalAt(sim, BEAR, 10);
    joinHerd(sim, bear);
    const invulnerable = fighterAtNode(sim, 12, 0, VIKING, WOODCUTTER);
    stampMissionBehaviour(sim.world, invulnerable, MISSION_BEHAVIOUR.INVULNERABLE);
    const hidden = fighterAtNode(sim, 8, 0, VIKING, WOODCUTTER);
    stampMissionBehaviour(sim.world, hidden, MISSION_BEHAVIOUR.HIDDEN_FROM_ANIMALS);
    const plain = fighterAtNode(sim, 16, 0, VIKING, WOODCUTTER);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, Engagement).target).toBe(plain);
  });

  it('a leader keeps a victim it already holds when the map hides him from animals', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const bear = animalAt(sim, BEAR, 10);
    joinHerd(sim, bear);
    const victim = fighterAtNode(sim, 12, 0, VIKING, WOODCUTTER);
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(bear, Engagement).target).toBe(victim);

    stampMissionBehaviour(sim.world, victim, MISSION_BEHAVIOUR.HIDDEN_FROM_ANIMALS);
    combatSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.get(bear, Engagement).target).toBe(victim);
  });

  it('an angry leader walking past 40 points from its stay point lets its victim go, and its follower too', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 1) });
    const victimAt = ANIMAL_ACQUIRE_RANGE_NODES + 12;
    const leader = animalAt(sim, BEAR, ANIMAL_ACQUIRE_RANGE_NODES - 4, 0);
    const follower = animalAt(sim, BEAR, ANIMAL_ACQUIRE_RANGE_NODES - 6, 0);
    joinHerd(sim, leader, follower);
    const victim = fighterAtNode(sim, victimAt, 0, VIKING, WOODCUTTER);
    sim.world.add(leader, Engagement, { repathAt: 0, target: victim });
    sim.world.add(follower, Engagement, { repathAt: 0, target: victim });

    let farthest = 0;
    for (let i = 0; i < 300; i++) {
      sim.step();
      farthest = Math.max(farthest, pointsFrom(sim, leader, 0));
    }

    expect(sim.world.get(victim, Health).hitpoints).toBe(sim.world.get(victim, Health).max);
    expect(sim.world.has(leader, Engagement)).toBe(false);
    expect(sim.world.has(follower, Engagement)).toBe(false);
    // The step that crosses the leash ends the walk.
    expect(farthest).toBeLessThanOrEqual(ANIMAL_ACQUIRE_RANGE_NODES + 1);
  });

  it('a provoked leader that drops its victim at the leash walks home while its anger still runs', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 1) });
    const boar = wildAt(sim, BOAR, ANIMAL_ACQUIRE_RANGE_NODES - 4, 0);
    sim.world.mut(boar, StayPoint).cell = node(sim, 0);
    joinHerd(sim, boar);
    const victim = fighterAtNode(sim, ANIMAL_ACQUIRE_RANGE_NODES + 12, 0, VIKING, WOODCUTTER);
    stampMissionBehaviour(sim.world, victim, MISSION_BEHAVIOUR.PASSIVE);
    sim.world.add(boar, Anger, { until: sim.tick + LONG_ANGER_TICKS });
    sim.world.add(boar, Engagement, { repathAt: 0, target: victim });

    for (let i = 0; i < LONG_ANGER_TICKS && sim.world.has(boar, Engagement); i++) sim.step();
    expect(sim.world.has(boar, Engagement)).toBe(false);
    const dropped = pointsFrom(sim, boar, 0);
    for (let i = 0; i < HOMEWARD_TICKS; i++) sim.step();

    expect(sim.world.get(boar, Anger).until).toBeGreaterThan(sim.tick);
    expect(pointsFrom(sim, boar, 0)).toBeLessThan(dropped - HOMEWARD_MIN_POINTS);
  });

  it('a provoked animal whose anger lapsed walks after its victim past the leash', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 1) });
    const boar = animalAt(sim, BOAR, ANIMAL_ACQUIRE_RANGE_NODES - 4, 0);
    joinHerd(sim, boar);
    const victim = fighterAtNode(sim, ANIMAL_ACQUIRE_RANGE_NODES + 12, 0, VIKING, WOODCUTTER);
    stampMissionBehaviour(sim.world, victim, MISSION_BEHAVIOUR.PASSIVE);
    sim.world.add(boar, Anger, { until: sim.tick });
    sim.world.add(boar, Engagement, { repathAt: 0, target: victim });

    for (let i = 0; i < 300 && pointsFrom(sim, boar, 0) <= ANIMAL_ACQUIRE_RANGE_NODES + 2; i++) sim.step();

    expect(pointsFrom(sim, boar, 0)).toBeGreaterThan(ANIMAL_ACQUIRE_RANGE_NODES + 2);
    expect(sim.world.get(boar, Engagement).target).toBe(victim);
  });

  it('an angry leader walking to its victim turns to one nearer its stay point', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(32, 1) });
    const stay = 10;
    const bear = animalAt(sim, BEAR, stay);
    joinHerd(sim, bear);
    const far = fighterAtNode(sim, stay + ANIMAL_AGGRO_RADIUS_NODES, 0, VIKING, WOODCUTTER);
    sim.world.add(bear, Engagement, { repathAt: 0, target: far });
    // The nearer man arrives once the bear is on its way.
    sim.step();
    sim.step();
    const near = fighterAtNode(sim, stay - 6, 0, VIKING, WOODCUTTER);

    for (let i = 0; i < 4; i++) sim.step();

    expect(sim.world.get(bear, Engagement).target).toBe(near);
  });

  it('a boar whose anger lapsed mid-attack stays an enemy: a fighter takes it up and its victim runs', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 1) });
    const boar = animalAt(sim, BOAR, 10);
    joinHerd(sim, boar);
    const victim = combatantAtNode(sim, 12, 0, P0, MILITARY_MODE.FLEE);
    const fighter = combatantAtNode(sim, 16, 0, P0, MILITARY_MODE.ATTACK);
    sim.world.add(boar, Anger, { until: sim.tick }); // lapsed this very tick
    sim.world.add(boar, Engagement, { repathAt: 0, target: victim });
    const ctx = fleeCheckCtxOf(sim, victim);
    expect(isFleeThreat(sim.world, ctx, victim, sim.world.get(victim, Settler), boar, new Set())).toBe(true);

    combatSystem(sim.world, ctx);

    expect(sim.world.get(boar, Engagement).target).toBe(victim);
    expect(sim.world.get(fighter, Engagement).target).toBe(boar);
    expect(sim.world.has(victim, Fleeing)).toBe(true);
  });

  it('an animal whose walk to a walled-in victim fails does not take the victim up again at once', () => {
    const sim = postMap(32);
    const terrain = mapTerrain(sim);
    const bear = fighterAtNode(sim, 6, 16, BEAR, null);
    sim.world.add(bear, StayPoint, { cell: terrain.nodeAt(6, 16) });
    joinHerd(sim, bear);
    const victim = fighterAtNode(sim, 16, 16, VIKING, WOODCUTTER);
    const at = terrain.nodeAt(16, 16);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const d = hexNodeDistance(terrain, at, terrain.nodeAt(x, y));
        if (d < 2 || d > 3) continue;
        sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL_POST, x, y, tribe: VIKING, force: true });
      }
    }

    let takes = 0;
    let held = false;
    for (let i = 0; i < 200; i++) {
      sim.step();
      const holds = sim.world.tryGet(bear, Engagement)?.target === victim;
      if (holds && !held) takes++;
      held = holds;
    }

    expect(takes).toBe(1);
    expect(sim.world.get(bear, UnreachableTargets).entries.map((entry) => entry.target)).toEqual([victim]);
  });
});
