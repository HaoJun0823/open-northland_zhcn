import { describe, expect, it } from 'vitest';
import {
  ANIMAL_FLAG,
  AnimalFlags,
  Frightened,
  Health,
  HerdMember,
  MoveGoal,
  Owner,
  Settler,
  StayPoint,
  WildHabitat,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type NodeId, positionOfNode, Simulation, type TerrainGraph } from '../../src/index.js';
import { type SystemContext, wildlifeSystem } from '../../src/systems/index.js';
import { LEADER_UPKEEP_PERIOD_TICKS } from '../../src/systems/movement/herd-roster.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { hexNodeDistance } from '../../src/systems/spatial/metric.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';
import { STAG, wildAt, wildContent } from '../fixtures/wildlife.js';

/**
 * Tests for the `setanimal` flags word: each honoured bit in one world with it and one without. The fixture
 * STAG keeps within 4 points of its stay point (fixtures/wildlife.ts). Coordinates are half-cell nodes.
 */

/** Original behavior: a wild leader breeds on the first 12 ticks of every 7200. */
const BREEDING_ROUND_TICKS = 7200;
/** A leader id residue whose upkeep slot falls inside the breeding window. */
const BREEDING_RESIDUE = 55;
/** Original behavior: the stay range a narrow-range animal keeps. */
const NARROW_STAY_RANGE = 5;
const VIKING = 1;
const PLAYER = 0;

function sim(): Simulation {
  return new Simulation({ seed: 1, content: wildContent(), map: grassMap(40, 20) });
}

function at(s: Simulation, tick: number): SystemContext {
  return { ...ctxOf(s), tick };
}

function terrainOf(s: Simulation): TerrainGraph {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('the fixture needs a map');
  return terrain;
}

function leading(s: Simulation, x: number, y: number, bits = 0): Entity {
  const e = wildAt(s, STAG, x, y);
  s.world.add(e, HerdMember, { leader: e });
  if (bits !== 0) s.world.add(e, AnimalFlags, { bits });
  return e;
}

function upkeepTick(e: Entity, from: number): number {
  return (
    from +
    ((LEADER_UPKEEP_PERIOD_TICKS - ((e + from) % LEADER_UPKEEP_PERIOD_TICKS)) % LEADER_UPKEEP_PERIOD_TICKS)
  );
}

/** A herd of two whose leader carries `bits` and comes due inside the breeding window. */
function breedingPair(s: Simulation, bits: number): Entity {
  while (s.world.nextEntityId % LEADER_UPKEEP_PERIOD_TICKS !== BREEDING_RESIDUE) s.world.create();
  const leader = leading(s, 40, 20, bits);
  wildAt(s, STAG, 44, 20, leader);
  return leader;
}

function stags(s: Simulation): Entity[] {
  return [...s.world.canonicalQuery(Settler, WildHabitat)].filter(
    (e) => s.world.get(e, Settler).tribe === STAG,
  );
}

describe('animal flags - the spawn', () => {
  it('stamps a placement’s flags word on the animal, and nothing for 0', () => {
    const s = sim();
    s.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: STAG, x: 20, y: 20, count: 1, flags: 9 });
    s.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: STAG, x: 60, y: 20, count: 1, flags: 0 });
    s.step();
    const [flagged, plain] = stags(s);
    if (flagged === undefined || plain === undefined) throw new Error('two stags expected');
    expect(s.world.get(flagged, AnimalFlags).bits).toBe(9);
    expect(s.world.has(plain, AnimalFlags)).toBe(false);
  });
});

describe('animal flags - the range', () => {
  it('a fixed work center stays put through the upkeep', () => {
    const s = sim();
    const fixed = leading(s, 20, 20, ANIMAL_FLAG.FIXED_WORK_CENTER);
    const free = leading(s, 60, 20);
    const terrain = terrainOf(s);

    wildlifeSystem(s.world, at(s, upkeepTick(fixed, 1)));
    wildlifeSystem(s.world, at(s, upkeepTick(free, 1)));

    expect(s.world.get(fixed, WildHabitat).workCenter).toBe(terrain.nodeAt(20, 20));
    expect(s.world.get(free, WildHabitat).workCenter).not.toBe(terrain.nodeAt(60, 20));
  });

  it('a narrow stay range keeps a leader 5 points out from walking back, where its species range does not', () => {
    const terrain = terrainOf(sim());
    const here = terrain.nodeAt(40, 20);
    let stay: NodeId | undefined;
    for (let x = 41; x < 60 && stay === undefined; x++) {
      if (hexNodeDistance(terrain, terrain.nodeAt(x, 20), here) === NARROW_STAY_RANGE)
        stay = terrain.nodeAt(x, 20);
    }
    if (stay === undefined) throw new Error('no point 5 out');
    const goals = [0, ANIMAL_FLAG.NARROW_STAY_RANGE].map((bits) => {
      const s = sim();
      const leader = leading(s, 40, 20, bits);
      s.world.mut(leader, StayPoint).cell = stay;
      wildlifeSystem(s.world, at(s, 1));
      return s.world.tryGet(leader, MoveGoal)?.cell;
    });
    expect(goals[0]).toBe(stay); // beyond the species' 4
    expect(goals[1]).not.toBe(stay); // within the flag's 5
  });
});

describe('animal flags - breeding', () => {
  it('a leader flagged never to breed adds no young', () => {
    const s = sim();
    const leader = breedingPair(s, ANIMAL_FLAG.NEVER_BREEDS);
    wildlifeSystem(s.world, at(s, upkeepTick(leader, BREEDING_ROUND_TICKS)));
    expect(stags(s)).toHaveLength(2);
  });

  it('the young carries its leader’s flags', () => {
    const s = sim();
    const leader = breedingPair(s, ANIMAL_FLAG.TAKES_NO_DAMAGE);
    wildlifeSystem(s.world, at(s, upkeepTick(leader, BREEDING_ROUND_TICKS)));
    const born = stags(s).at(-1);
    if (born === undefined || stags(s).length !== 3) throw new Error('one young expected');
    expect(s.world.get(born, AnimalFlags).bits).toBe(ANIMAL_FLAG.TAKES_NO_DAMAGE);
  });
});

describe('animal flags - a blow', () => {
  it('an animal flagged to take no damage keeps its hitpoints and still answers the blow', () => {
    const s = sim();
    const shielded = leading(s, 10, 10, ANIMAL_FLAG.TAKES_NO_DAMAGE);
    const plain = leading(s, 70, 30);
    const hunter = settlerAt(s, { jobType: null, tribe: VIKING, position: positionOfNode(40, 20) });
    s.world.add(hunter, Owner, { player: PLAYER });
    s.world.add(hunter, Health, { hitpoints: 100, max: 100 });
    const before = s.world.get(shielded, Health).hitpoints;

    resolveCombatHit(s.world, ctxOf(s), hunter, shielded, { damage: 25 }, [], 'melee');
    resolveCombatHit(s.world, ctxOf(s), hunter, plain, { damage: 25 }, [], 'melee');

    expect(s.world.get(shielded, Health).hitpoints).toBe(before);
    expect(s.world.get(plain, Health).hitpoints).toBeLessThan(before);
    expect(s.world.has(shielded, Frightened)).toBe(s.world.has(plain, Frightened));
  });
});
