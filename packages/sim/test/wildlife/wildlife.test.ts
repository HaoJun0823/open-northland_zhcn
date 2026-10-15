import { describe, expect, it } from 'vitest';
import {
  Anger,
  Building,
  Health,
  HerdMember,
  Livestock,
  MoveGoal,
  Owner,
  Position,
  Settler,
  StayPoint,
  WildHabitat,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  type NodeId,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainGraph,
} from '../../src/index.js';
import { type SystemContext, wildlifeSystem } from '../../src/systems/index.js';
import { tearDownLoser } from '../../src/systems/match/teardown.js';
import { herdRoster, LEADER_UPKEEP_PERIOD_TICKS } from '../../src/systems/movement/herd-roster.js';
import { hexNodeDistance } from '../../src/systems/spatial/metric.js';
import { buildingSectors } from '../../src/systems/wildlife/building-sectors.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';
import { LYNX, STAG, WILD_HITPOINTS, wildAt, wildContent } from '../fixtures/wildlife.js';

/**
 * Tests for the wildlife drive: a wild animal's meals, its leader's graze legs and range upkeep, and
 * breeding. The fixture STAG grazes in herds of 4, 3 points from its leader, 4 from its stay point and 10
 * from its birth point (fixtures/wildlife.ts). Coordinates are half-cell nodes.
 */

/** The fixture BEAR: an aggressive species, so its adults are always hostile. */
const BEAR = 10;
/** A grass sector grid of 4 by 2 sectors of 20 map points. */
const MAP_CELLS_WIDE = 40;
const MAP_CELLS_HIGH = 20;
/** Original behavior: a meal is 100..499. */
const MEAL_MIN = 100;
const MEAL_MAX = 499;
/** Original behavior: a stay point's food is 100 per grass point within 10, at least 5000. */
const FOOD_FLOOR = 5000;
/** Original behavior: a wild leader breeds on the first 12 ticks of every 7200. */
const BREEDING_ROUND_TICKS = 7200;
const BREEDING_WINDOW_TICKS = 12;

function sim(seed = 1): Simulation {
  return new Simulation({ seed, content: wildContent(), map: grassMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH) });
}

function at(s: Simulation, tick: number): SystemContext {
  return { ...ctxOf(s), tick };
}

function terrainOf(s: Simulation): TerrainGraph {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('the fixture needs a map');
  return terrain;
}

function nodeOf(s: Simulation, x: number, y: number): NodeId {
  return terrainOf(s).nodeAt(x, y);
}

function leading(s: Simulation, x: number, y: number): Entity {
  const e = wildAt(s, STAG, x, y);
  s.world.add(e, HerdMember, { leader: e });
  return e;
}

/** The first tick from `from` on which leader `e`'s range upkeep runs. */
function upkeepTick(e: Entity, from: number): number {
  return (
    from +
    ((LEADER_UPKEEP_PERIOD_TICKS - ((e + from) % LEADER_UPKEEP_PERIOD_TICKS)) % LEADER_UPKEEP_PERIOD_TICKS)
  );
}

/** Create throwaway entities until the next one gets an id with `residue` modulo the upkeep period. */
function nextIdWithResidue(s: Simulation, residue: number): void {
  while (s.world.nextEntityId % LEADER_UPKEEP_PERIOD_TICKS !== residue) s.world.create();
}

describe('wildlifeSystem - meals', () => {
  it('a hungry animal on grass eats: hunger, a tenth of the meal as hitpoints, and its leader food', () => {
    const s = sim();
    const leader = leading(s, 20, 20);
    const follower = wildAt(s, STAG, 22, 20, leader);
    s.world.mut(follower, WildHabitat).fedUntil = 0;
    s.world.mut(follower, Health).hitpoints = 300;
    const food = s.world.get(leader, WildHabitat).food;

    wildlifeSystem(s.world, at(s, 1));

    const meal = s.world.get(follower, WildHabitat).fedUntil;
    expect(meal).toBeGreaterThanOrEqual(MEAL_MIN);
    expect(meal).toBeLessThanOrEqual(MEAL_MAX);
    expect(s.world.get(follower, Health).hitpoints).toBe(300 + Math.floor(meal / 10));
    expect(s.world.get(leader, WildHabitat).food).toBe(food - meal);
    expect(s.world.get(follower, WildHabitat).nextStayAt).toBeGreaterThan(1); // the meal clip plays first
    expect(s.world.has(follower, MoveGoal)).toBe(false);
  });

  it('a wounded animal heals back to its pool while grazing, never past it', () => {
    const s = sim();
    const stag = leading(s, 20, 20);
    s.world.mut(stag, Health).hitpoints = WILD_HITPOINTS - 150;
    for (let tick = 1; tick < 4000; tick++) {
      // Hungry again at every decision, so each one is a meal.
      if (s.world.get(stag, WildHabitat).fedUntil !== 0) s.world.mut(stag, WildHabitat).fedUntil = 0;
      wildlifeSystem(s.world, at(s, tick));
    }
    expect(s.world.get(stag, Health).hitpoints).toBe(WILD_HITPOINTS);
  });

  it('a hostile adult skips its meal and spends one food per decision', () => {
    const s = sim();
    const bear = wildAt(s, BEAR, 20, 20);
    s.world.add(bear, HerdMember, { leader: bear });
    s.world.mut(bear, WildHabitat).fedUntil = 0;
    s.world.mut(bear, Health).hitpoints = 100;
    const food = s.world.get(bear, WildHabitat).food;

    wildlifeSystem(s.world, at(s, 1));

    expect(s.world.get(bear, Health).hitpoints).toBe(100);
    expect(s.world.get(bear, WildHabitat).fedUntil).toBe(0);
    expect(s.world.get(bear, WildHabitat).food).toBe(food - 1);
  });

  it('a provoked adult out of any fight skips its meal and spends one food while its anger runs', () => {
    const s = sim();
    const stag = leading(s, 20, 20);
    s.world.mut(stag, WildHabitat).fedUntil = 0;
    s.world.add(stag, Anger, { until: 100 });
    const food = s.world.get(stag, WildHabitat).food;

    wildlifeSystem(s.world, at(s, 1));

    expect(s.world.get(stag, WildHabitat).fedUntil).toBe(0);
    expect(s.world.get(stag, WildHabitat).food).toBe(food - 1);
    expect(s.world.get(stag, WildHabitat).nextStayAt).toBeGreaterThan(1);
    expect(s.world.has(stag, MoveGoal)).toBe(false); // it stands while its anger runs
  });

  it('a hungry animal off grass walks to grass within its leader distance', () => {
    const s = new Simulation({ seed: 1, content: wildContent(), map: barrenStripMap() });
    const stag = leading(s, 20, 20); // on the barren strip, grass 4 points east
    s.world.mut(stag, WildHabitat).fedUntil = 0;

    wildlifeSystem(s.world, at(s, 1));

    const goal = s.world.get(stag, MoveGoal).cell;
    expect(terrainOf(s).isPlantable(goal)).toBe(true);
    expect(hexNodeDistance(terrainOf(s), goal, nodeOf(s, 20, 20))).toBeLessThanOrEqual(3);
  });
});

describe('wildlifeSystem - the leader leads the herd', () => {
  it('a leader with its food used up walks a graze leg out from its work center, and its herd follows', () => {
    const s = sim();
    const leader = leading(s, 40, 20);
    s.world.mut(leader, WildHabitat).food = 0;
    const follower = wildAt(s, STAG, 42, 20, leader);
    const terrain = terrainOf(s);

    wildlifeSystem(s.world, at(s, 1));

    const target = s.world.get(leader, MoveGoal).cell;
    expect(s.world.get(leader, WildHabitat).nextPoint).toBe(target);
    const out = hexNodeDistance(terrain, target, nodeOf(s, 40, 20));
    expect(out).toBeGreaterThanOrEqual(5);
    expect(out).toBeLessThanOrEqual(10);
    // The follower, though close, heads for the leader's graze point.
    const follow = s.world.get(follower, MoveGoal).cell;
    expect(hexNodeDistance(terrain, follow, target)).toBeLessThanOrEqual(3);
  });

  it('on reaching its graze point a leader makes it its stay point, with the food around it', () => {
    const s = sim();
    const leader = leading(s, 40, 20);
    s.world.mut(leader, WildHabitat).food = 0;
    wildlifeSystem(s.world, at(s, 1));
    const target = s.world.get(leader, MoveGoal).cell;
    const terrain = terrainOf(s);

    // Stand in for the walk: on the point, goal gone, due to decide.
    s.world.mut(leader, Position).x = positionOfNode(terrain.xOf(target), terrain.yOf(target)).x;
    s.world.mut(leader, Position).y = positionOfNode(terrain.xOf(target), terrain.yOf(target)).y;
    s.world.remove(leader, MoveGoal);
    wildlifeSystem(s.world, at(s, 2));

    expect(s.world.get(leader, StayPoint).cell).toBe(target);
    expect(s.world.get(leader, WildHabitat).food).toBeGreaterThanOrEqual(FOOD_FLOOR);
    expect(s.world.get(leader, WildHabitat).nextPoint).toBeUndefined();
  });

  it("a graze point's food is added to what is left, floored at 5000", () => {
    const grassFood = (left: number): number => {
      const s = sim();
      const leader = leading(s, 40, 20);
      s.world.mut(leader, WildHabitat).nextPoint = nodeOf(s, 40, 20); // standing on its reached graze point
      s.world.mut(leader, WildHabitat).food = left;
      wildlifeSystem(s.world, at(s, 1));
      return s.world.get(leader, WildHabitat).food;
    };
    const fresh = grassFood(0);
    expect(fresh).toBeGreaterThan(FOOD_FLOOR);
    expect(grassFood(FOOD_FLOOR)).toBe(fresh + FOOD_FLOOR);
    expect(grassFood(-10 * fresh)).toBe(FOOD_FLOOR);
  });

  it('a follower gathered across water leaves its leader and leads itself', () => {
    const s = new Simulation({ seed: 1, content: wildContent(), map: waterColumnMap(40, 20, 20) });
    const leader = leading(s, 20, 20); // west of the water
    s.world.mut(leader, WildHabitat).nextStayAt = 1000; // the leader idles through this pass
    const stranded = wildAt(s, STAG, 60, 20, leader); // east of it, beyond its leader distance
    s.world.mut(stranded, WildHabitat).workCenter = nodeOf(s, 70, 20);
    s.world.mut(stranded, WildHabitat).nextPoint = nodeOf(s, 70, 20);
    expect(herdRoster(s.world).herdSize(leader)).toBe(2);

    wildlifeSystem(s.world, at(s, 1));

    expect(s.world.get(stranded, HerdMember).leader).toBe(stranded);
    expect(s.world.has(stranded, MoveGoal)).toBe(false);
    expect(herdRoster(s.world).herdSize(leader)).toBe(1);
    // It starts its grazing afresh where it stands, as a new leader of the leadership drive does.
    const habitat = s.world.get(stranded, WildHabitat);
    expect(habitat.food).toBe(0);
    expect(habitat.workCenter).toBe(nodeOf(s, 60, 20));
    expect(habitat.nextPoint).toBeUndefined();
  });

  it('a follower beyond its leader distance walks back beside the leader', () => {
    const s = sim();
    const leader = leading(s, 40, 20);
    const follower = wildAt(s, STAG, 50, 20, leader);
    s.world.mut(leader, WildHabitat).nextStayAt = 1000; // the leader idles through this pass

    wildlifeSystem(s.world, at(s, 1));

    const terrain = terrainOf(s);
    expect(
      hexNodeDistance(terrain, s.world.get(follower, MoveGoal).cell, nodeOf(s, 40, 20)),
    ).toBeLessThanOrEqual(3);
  });

  it('a leader strayed from its stay point walks back to it', () => {
    const s = sim();
    const leader = leading(s, 40, 20);
    s.world.mut(leader, StayPoint).cell = nodeOf(s, 30, 20);
    s.world.mut(leader, WildHabitat).birth = nodeOf(s, 30, 20);

    wildlifeSystem(s.world, at(s, 1));

    expect(s.world.get(leader, MoveGoal).cell).toBe(nodeOf(s, 30, 20));
  });
});

describe('wildlifeSystem - range upkeep', () => {
  it("drifts a leader's birth point out of a sector with a player's building, to the emptiest neighbour", () => {
    const s = sim();
    const leader = leading(s, 30, 30); // sector (1, 1)
    const house = s.world.create();
    s.world.add(house, Position, positionOfNode(25, 25));
    s.world.add(house, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
    s.world.add(house, Owner, { player: 0 });

    wildlifeSystem(s.world, at(s, upkeepTick(leader, 1)));

    // Every neighbour is empty; the first in turning order, east, wins: sector (2, 1)'s corner.
    expect(s.world.get(leader, WildHabitat).birth).toBe(nodeOf(s, 40, 20));
  });

  it('keeps the birth point where no player has built', () => {
    const s = sim();
    const leader = leading(s, 30, 30);

    wildlifeSystem(s.world, at(s, upkeepTick(leader, 1)));

    expect(s.world.get(leader, WildHabitat).birth).toBe(nodeOf(s, 30, 30));
  });

  it('creeps the work center one point over grass, inside the birth range and away from buildings', () => {
    const s = sim();
    const leader = leading(s, 40, 20);
    const terrain = terrainOf(s);

    wildlifeSystem(s.world, at(s, upkeepTick(leader, 1)));

    expect(hexNodeDistance(terrain, s.world.get(leader, WildHabitat).workCenter, nodeOf(s, 40, 20))).toBe(1);
  });
});

describe('building sectors', () => {
  it('a walking animal is no change the sectors replay', () => {
    const s = sim();
    const stag = leading(s, 40, 20);
    const sectors = buildingSectors(s.world, terrainOf(s));
    s.world.mut(stag, Position).x = positionOfNode(41, 20).x;
    expect(sectors.feed.pending).toBe(false);
  });
});

describe('wildlifeSystem - breeding', () => {
  /** A herd of two whose leader's id is `residue` modulo the upkeep period. */
  function pairWithLeaderResidue(s: Simulation, residue: number): Entity {
    nextIdWithResidue(s, residue);
    const leader = leading(s, 40, 20);
    wildAt(s, STAG, 44, 20, leader);
    return leader;
  }

  function stags(s: Simulation): number {
    return [...s.world.query(Settler, WildHabitat)].filter((e) => s.world.get(e, Settler).tribe === STAG)
      .length;
  }

  it('a leader whose upkeep slot falls in the breeding window adds an adult on its point', () => {
    const s = sim();
    const leader = pairWithLeaderResidue(s, 55); // its upkeep runs on tick 7205 of the window
    const tick = upkeepTick(leader, BREEDING_ROUND_TICKS);
    expect(tick - BREEDING_ROUND_TICKS).toBeLessThan(BREEDING_WINDOW_TICKS);

    wildlifeSystem(s.world, at(s, tick));

    expect(stags(s)).toBe(3);
    const born = [...s.world.query(Settler, WildHabitat)].find((e) => e > leader + 1);
    expect(born).toBeDefined();
    expect(s.world.get(born as Entity, Health).hitpoints).toBe(WILD_HITPOINTS); // born adult
    expect(s.world.get(born as Entity, HerdMember).leader).toBe(leader); // it joins the herd that bore it
  });

  it('no breeding outside the window, and never for a leader whose slot misses it', () => {
    const s = sim();
    const inWindow = pairWithLeaderResidue(s, 55);
    const missing = pairWithLeaderResidue(s, 20); // its upkeep lands 40 ticks into the round
    wildlifeSystem(s.world, at(s, upkeepTick(inWindow, BREEDING_ROUND_TICKS + BREEDING_WINDOW_TICKS)));
    for (let tick = BREEDING_ROUND_TICKS; tick < BREEDING_ROUND_TICKS + LEADER_UPKEEP_PERIOD_TICKS; tick++) {
      if ((missing + tick) % LEADER_UPKEEP_PERIOD_TICKS === 0) wildlifeSystem(s.world, at(s, tick));
    }
    expect(stags(s)).toBe(4);
  });

  it('a pair of a species that never seeks a leader fills its own herd and then stops', () => {
    const s = sim();
    nextIdWithResidue(s, 55);
    const leader = wildAt(s, LYNX, 40, 20);
    s.world.add(leader, HerdMember, { leader });
    wildAt(s, LYNX, 44, 20, leader);
    const lynxes = (): number =>
      [...s.world.query(Settler, WildHabitat)].filter((e) => s.world.get(e, Settler).tribe === LYNX).length;

    for (const round of [1, 2, 3]) {
      wildlifeSystem(s.world, at(s, upkeepTick(leader, round * BREEDING_ROUND_TICKS)));
    }

    expect(lynxes()).toBe(3);
  });

  it('a lone animal or a full herd does not breed', () => {
    const s = sim();
    nextIdWithResidue(s, 55);
    const lone = leading(s, 20, 20);
    nextIdWithResidue(s, 55);
    const full = leading(s, 60, 20);
    for (const x of [62, 64, 66]) wildAt(s, STAG, x, 20, full);
    const before = stags(s);

    wildlifeSystem(s.world, at(s, upkeepTick(lone, BREEDING_ROUND_TICKS)));
    wildlifeSystem(s.world, at(s, upkeepTick(full, BREEDING_ROUND_TICKS)));

    expect(stags(s)).toBe(before);
  });
});

describe('wildlifeSystem - determinism', () => {
  it('a restored save continues wild herd life tick for tick, breeding round included', () => {
    const map = grassMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH);
    const live = new Simulation({ seed: 4, content: wildContent(), map });
    live.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: STAG, x: 40, y: 20, count: 2 });
    live.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: STAG, x: 100, y: 30 });
    const house = live.world.create();
    live.world.add(house, Position, positionOfNode(45, 25));
    live.world.add(house, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
    live.world.add(house, Owner, { player: 0 });
    live.run(BREEDING_ROUND_TICKS - 300);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(live)))), {
      content: wildContent(),
      map,
    });
    live.run(600);
    restored.run(600);

    expect(restored.hashState()).toBe(live.hashState());
    expect(live.checkInvariants()).toEqual([]);
  });
});

describe('wildlifeSystem - released livestock', () => {
  /** The fixture COW: catchable livestock that keeps no herd. */
  const COW = 13;
  const LOSER = 1;

  function cows(s: Simulation): Entity[] {
    return [...s.world.canonicalQuery(Livestock)].filter((e) => s.world.get(e, Settler).tribe === COW);
  }

  it('an owned animal that came due while owned decides again once its owner lets it go', () => {
    const s = sim();
    const cow = wildAt(s, COW, 20, 20);
    s.world.add(cow, Livestock, {});
    s.world.add(cow, Owner, { player: LOSER });

    wildlifeSystem(s.world, at(s, 1)); // due, but claimed: the clock drops it
    expect(s.world.get(cow, WildHabitat).nextStayAt).toBe(0);
    s.world.remove(cow, Owner);
    wildlifeSystem(s.world, at(s, 2));

    expect(s.world.get(cow, WildHabitat).nextStayAt).toBeGreaterThan(2);
  });

  it("a torn-down seat's map-placed and captured livestock graze on, and a restored save agrees", () => {
    const map = grassMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH);
    const live = new Simulation({ seed: 3, content: wildContent(), map });
    live.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: COW, x: 20, y: 20, count: 1, owner: LOSER });
    live.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: COW, x: 60, y: 20, count: 1 });
    live.step();
    const [placed, captured] = cows(live);
    if (placed === undefined || captured === undefined) throw new Error('two cows expected');
    // A scout's claim, as the capture drive stamps it.
    live.world.add(captured, Owner, { player: LOSER });
    live.world.remove(captured, HerdMember);
    live.world.remove(captured, WildHabitat);
    live.run(300); // the map-placed cow comes due while owned

    tearDownLoser(live.world, ctxOf(live), LOSER);
    const released = live.tick;
    live.run(50);
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(live)))), {
      content: wildContent(),
      map,
    });
    live.run(600);
    restored.run(600);

    expect(restored.hashState()).toBe(live.hashState());
    for (const cow of [placed, captured]) {
      expect(live.world.has(cow, Owner)).toBe(false);
      expect(live.world.get(cow, WildHabitat).nextStayAt).toBeGreaterThan(released + 50);
    }
  });
});

/** A grass map with a barren (walkable, unplantable) strip four nodes wide down node columns 18..21. */
function barrenStripMap(): { resolution: 'half-cell'; width: number; height: number; typeIds: number[] } {
  const GRASS = 0;
  const BARREN = 2;
  const width = 2 * MAP_CELLS_WIDE;
  const height = 2 * MAP_CELLS_HIGH;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let y = 0; y < height; y++) for (let x = 18; x <= 21; x++) typeIds[y * width + x] = BARREN;
  return { resolution: 'half-cell', width, height, typeIds };
}
