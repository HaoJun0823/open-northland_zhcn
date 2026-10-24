import { describe, expect, it } from 'vitest';
import {
  ANIMAL_FLAG,
  Anger,
  AnimalFlags,
  AttackOrder,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Health,
  HuntFocus,
  HuntRest,
  KilledBy,
  Position,
  ProductionCounters,
  Resource,
  ResourceLayers,
  removeCurrentAtomic,
  Stance,
  WorkFlag,
  YoungAnimal,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  checkInvariants,
  FOG_MODE,
  halfCellMapFromCells,
  positionOfNode,
  Simulation,
} from '../../../../src/index.js';
import { HUNT_SEARCH_REST_TICKS } from '../../../../src/systems/conflict/hunting/index.js';
import { HUNT_PREY_SCORE_CEILING } from '../../../../src/systems/conflict/hunting/spec.js';
import {
  anchorOnlyFootprint,
  combatSystem,
  stampResourceFootprintData,
} from '../../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { noteUnreachableGoal } from '../../../../src/systems/settlers/unreachable-goals.js';
import { playerSeesEntity } from '../../../../src/systems/vision/index.js';
import { testContent } from '../../../fixtures/content.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import { combatantAtNode, P0 } from '../stances/support.js';
import { COW, ctxOf, DEER, fighterAtNode, HUNTER, WOLVES } from './support.js';

/**
 * The hunter's HUNTING GROUND and prey pick (engageSpec's hunter branch): a flag-bound hunter acquires
 * prey only within its work-flag circle (the flag anchors the chase leash), takes no new target while a
 * harvestable carcass lies in the ground (one kill at a time), and among the wild `warrantable` animals
 * that are not hostile picks the lowest distance plus hit points. Once it has drawn on an animal it stays on THAT one
 * (the `HuntFocus` lock) out to the leash, so a bolting kill is run down instead of traded for whatever
 * grazes nearest.
 * The fixture hunter weapon `test_spear` (tribe 1, job 15) has band [3, 17].
 */
/** The fixture meat good and its harvest_cadaver atomic - the hunter's own trade (granted to job 15). */
const MEAT = 21;
const LEATHER = 22;
const HARVEST_CADAVER = 33;
/** The fixture woodcutter's good and harvest atomic - another trade's resource, never the hunter's work. */
const WOOD = 1;
const HARVEST_WOOD = 24;
/** Fixture ground types (`economy.ts` landscapes): grass walks, water does not. */
const GRASS = 0;
const WATER = 1;

describe('combatSystem - the hunter hunting ground and prey pick', () => {
  /** Bind `hunter` to a work flag standing on half-cell node (hx, hy). `radius` in nodes. */
  function bindFlagAtNode(sim: Simulation, hunter: Entity, hx: number, hy: number, radius: number): Entity {
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(hx, hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(hunter, WorkFlag, { flag, radius });
    return flag;
  }

  /** Teleport `e` onto half-cell node (hx, hy) - a prey animal bolting, without running the mover. */
  function moveToNode(sim: Simulation, e: Entity, hx: number, hy: number): void {
    const p = sim.world.mut(e, Position);
    const at = positionOfNode(hx, hy);
    p.x = at.x;
    p.y = at.y;
  }

  /** Stand a hunter that has just loosed a shot back up: the draw atomic has played out, so it is free
   *  to act again on the next combat pass. */
  function drawFinished(sim: Simulation, hunter: Entity): void {
    removeCurrentAtomic(sim.world, hunter);
  }

  it('leaves prey OUTSIDE its flag radius alone, even inside plain sight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground: 4 nodes around the hunter's own node
    fighterAtNode(sim, 46, 40, COW, null); // 6 nodes off - in the test_spear band, OUT of the ground

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // no swing at out-of-ground prey
    expect(sim.world.has(hunter, Engagement)).toBe(false); // and no chase toward it
  });

  it('measures the ground in map points: a diagonal step reaches farther than a Manhattan one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 8);
    // 8 rows and 4 columns off: 8 map points, 12 Manhattan nodes - inside the ground.
    const deer = fighterAtNode(sim, 44, 48, DEER, null);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });
  });

  it('takes game in its ground the player has never seen - fog hides no game from a hunter', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 30);
    const deer = fighterAtNode(sim, 56, 40, DEER, null);
    sim.step();
    expect(playerSeesEntity(sim.world, sim.fog, P0, deer)).toBe(false);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, HuntFocus).target).toBe(deer);
  });

  it('picks the lowest distance plus hit points: a weaker animal farther off beats a nearer tough one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, COW, null, 1000); // 3 + 1000
    const deer = fighterAtNode(sim, 45, 40, DEER, null, 500); // 5 + 500

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });
  });

  it('breaks an even hit-point match on distance from the hunter', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null); // nearer
    fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('never picks an animal whose score reaches the ceiling', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, COW, null, HUNT_PREY_SCORE_CEILING);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
  });

  it('skips an angry animal and takes the calm one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const deer = fighterAtNode(sim, 43, 40, DEER, null, 500);
    sim.world.add(deer, Anger, { until: sim.tick + HUNT_SEARCH_REST_TICKS });
    const cow = fighterAtNode(sim, 45, 40, COW, null);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('skips an animal whose map flags say it takes no damage, yet shoots it on an order', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const unhurt = fighterAtNode(sim, 43, 40, COW, null);
    sim.world.add(unhurt, AnimalFlags, { bits: ANIMAL_FLAG.TAKES_NO_DAMAGE });
    const cow = fighterAtNode(sim, 45, 40, COW, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });

    drawFinished(sim, hunter);
    sim.world.remove(hunter, HuntFocus);
    sim.world.add(hunter, AttackOrder, { target: unhurt });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: unhurt });
  });

  it('leaves an adult of an aggressive type alone but hunts its young', () => {
    const base = testContent();
    const content = {
      ...base,
      animals: base.animals.map((a) => (a.tribeType === DEER ? { ...a, aggressive: true } : a)),
    };
    const sim = new Simulation({ seed: 1, content, map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, DEER, null);
    const young = fighterAtNode(sim, 47, 40, DEER, null);
    sim.world.add(young, YoungAnimal, { adultAt: sim.tick + HUNT_SEARCH_REST_TICKS });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: young });
  });

  it('leaves a wild animal of a type that is not warrantable alone', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, WOLVES, null, 1);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
  });

  it('sends a second hunter to the next game when a colleague holds the best one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const first = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const second = combatantAtNode(sim, 40, 42, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, first, 40, 40, 12);
    bindFlagAtNode(sim, second, 40, 42, 12);
    const deer = fighterAtNode(sim, 45, 40, DEER, null, 500); // the weakest, both can reach it
    const cow = fighterAtNode(sim, 43, 42, COW, null);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(first, HuntFocus).target).toBe(deer);
    expect(sim.world.get(second, HuntFocus).target).toBe(cow);
  });

  it('takes NO new target while a harvestable carcass still lies in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null); // normal game in the band - but the hunter is not idle:
    fighterAtNode(sim, 43, 40, COW, null); // (and livestock too)
    const carcass = sim.world.create(); // an unharvested carcass node of the hunter's own trade
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());

    combatSystem(sim.world, ctxOf(sim));

    // One kill at a time: carry the standing kill home before the next shot - no swing, no chase.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it("still gates on a carcass that stands among another trade's resources", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null);
    for (const hx of [34, 36, 38, 42]) {
      const tree = sim.world.create();
      sim.world.add(tree, Position, positionOfNode(hx, 44));
      sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_WOOD });
      stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
    }
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('a carcass holding no good its production counters leave open does not gate new kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());
    sim.world.add(hunter, ProductionCounters, { counters: [[MEAT, 0]], cursor: 0 }); // leather only

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('a body still worth an open good gates new kills, whatever stage lies on top', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, COW, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 1, harvestAtomic: HARVEST_CADAVER });
    sim.world.add(carcass, ResourceLayers, {
      layers: [{ goodType: LEATHER, amount: 1, harvestAtomic: HARVEST_CADAVER }],
    });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());
    sim.world.add(hunter, ProductionCounters, { counters: [[MEAT, 0]], cursor: 0 }); // leather only

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('takes no game at all while its counters stop every good it plucks', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null);
    sim.world.add(hunter, ProductionCounters, {
      counters: [
        [MEAT, 0],
        [LEATHER, 0],
      ],
      cursor: 0,
    });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('takes NO new target while CARRYING a load - the kill is fully banked before the next shot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null); // fresh game in the band - but the meat on the back comes first
    // The last pickup's load: the carcass node is gone, only the carry leg remains.
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it("an explicit ATTACK ORDER pierces the carrying veto - the player's order is authoritative", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });
    sim.world.add(hunter, AttackOrder, { target: cow });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('rests after an EMPTY search (HuntRest), then re-acquires once the breather lapses', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground
    // Prey on the map (so the dormancy gate wakes combat at all) but OUT of the ground: the hunter's
    // full-band search comes up empty.
    const cow = fighterAtNode(sim, 46, 40, COW, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, HuntRest)).toBe(true); // the empty search stamped the breather

    // The cow steps INTO the ground mid-breather: still resting, the search is skipped.
    const p = sim.world.mut(cow, Position);
    const inGround = positionOfNode(43, 40);
    p.x = inGround.x;
    p.y = inGround.y;
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);

    combatSystem(sim.world, { ...ctxOf(sim), tick: HUNT_SEARCH_REST_TICKS });
    expect(sim.world.has(hunter, HuntRest)).toBe(false); // the lapsed breather is reaped on read
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('a carcass fallen just PAST the flag radius (the kill slack) still gates - and still gets banked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground
    fighterAtNode(sim, 43, 40, COW, null); // prey in the band - must wait for the banking
    // A kill the chase leash permitted, fallen 2 nodes past the radius: inside the slack band.
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(46, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 1, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // the out-of-radius carcass still gates
    expect(sim.world.has(hunter, Engagement)).toBe(false);

    // ... and the harvest drive's reach covers the slack band too: the meat ends up on the back,
    // never stranded past an invisible line.
    let guard = 600;
    while (!sim.world.has(hunter, Carrying) && guard-- > 0) sim.step();
    expect(sim.world.tryGet(hunter, Carrying)?.goodType).toBe(MEAT);
  });

  it('stays on the animal it drew on, following it PAST the flag circle, while a nearer one grazes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12); // ground radius 12, so the chase leash reaches 16
    const wounded = fighterAtNode(sim, 45, 40, DEER, null); // dist 5 - squarely in the band

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });

    // The shot scatters the herd: the struck deer bolts to node 55 - out of the flag circle (15 > 12)
    // but inside the leash - while an untouched one wanders into easy reach.
    drawFinished(sim, hunter);
    moveToNode(sim, wounded, 55, 40);
    fighterAtNode(sim, 44, 40, DEER, null); // dist 4 - nearer, in the band, in the ground

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    // The lock holds: the second arrow goes after the wounded animal, not the convenient one.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);
  });

  it('gives the animal up once it outruns the chase leash, and takes the game still in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const escaped = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(escaped);

    // 18 nodes from the flag - past the leash (16). The commitment is not a licence to leave the ground.
    drawFinished(sim, hunter);
    moveToNode(sim, escaped, 58, 40);
    const nearby = fighterAtNode(sim, 44, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: nearby });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(nearby);
  });

  it('gives the animal up when it drops - the lock never outlives its prey', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const felled = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(felled);

    drawFinished(sim, hunter);
    sim.world.mut(felled, Health).hitpoints = 0;
    const next = fighterAtNode(sim, 43, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: next });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(next);
  });

  it('keeps its hold while it stays valid, even when weaker game walks in', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(cow);

    drawFinished(sim, hunter);
    fighterAtNode(sim, 44, 40, DEER, null, 100);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(cow);
  });

  it('sheds the hold when the hunter stops hunting - it never outlives the engagement', () => {
    for (const mode of [MILITARY_MODE.FLEE, MILITARY_MODE.DEFEND] as const) {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
      const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
      bindFlagAtNode(sim, hunter, 40, 40, 12);
      const deer = fighterAtNode(sim, 45, 40, DEER, null);

      combatSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(hunter, HuntFocus).target).toBe(deer);

      // The player re-tasks the hunter. Nothing but the hunting branch can reap the hold, so a stance
      // that no longer runs it must shed the hold itself or a dead animal id rides the state hash on.
      drawFinished(sim, hunter);
      sim.world.mut(hunter, Stance).mode = mode;
      combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

      expect(sim.world.has(hunter, HuntFocus), `mode ${mode}`).toBe(false);
      expect(checkInvariants(sim.world, sim.content), `mode ${mode}`).toEqual([]);
    }
  });

  it('never takes game across a static terrain seam - unreachable prey is not its game', () => {
    // A full-height water column at cell x=22 (nodes 44..45) splits the map: the hunter's bank and the
    // deer's are different terrain components, so no route between them can ever resolve.
    const width = 64;
    const height = 64;
    const typeIds = new Array(width * height).fill(GRASS);
    for (let y = 0; y < height; y++) typeIds[y * width + 22] = WATER;
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: halfCellMapFromCells({ width, height, typeIds }),
    });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 48, 40, DEER, null); // 8 nodes off and inside the ground - but over the water

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
    expect(sim.world.has(hunter, HuntRest)).toBe(true); // the search came up empty, so it rests
  });

  it('rests after a chase that gave its prey up, not only after an empty search', () => {
    // Prey inside the ground but shootable only from outside the chase leash: the hunter stands 20 nodes from
    // its flag, so every cell of the spear's band around the deer lies past `radius + slack` of the anchor and
    // the chase hands the hunter back rather than the search coming up empty.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 60, 40, 4); // a tight ground the hunter is standing well away from
    fighterAtNode(sim, 62, 40, DEER, null); // in the ground, 22 nodes off - past the spear's 17-node reach

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // out of reach, so no swing
    expect(sim.world.has(hunter, Engagement)).toBe(false); // the chase gave up at the leash
    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
    expect(sim.world.has(hunter, HuntRest)).toBe(true);
  });

  it('an UNPOSTED hunter (no flag, no workplace) holds its prey out to plain sight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const wounded = fighterAtNode(sim, 45, 40, DEER, null); // no work flag: the hunt is sight-bound

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);

    drawFinished(sim, hunter);
    moveToNode(sim, wounded, 55, 40); // 15 nodes off - inside the spear's band and plain sight
    fighterAtNode(sim, 44, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });
  });

  it('drops the lock for a carcass that appears mid-chase - one kill at a time still wins', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const wounded = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);

    // An earlier kill of the hunter's own trade is lying in the ground: the meat comes home first.
    drawFinished(sim, hunter);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('two hunters sharing a ground draw on DIFFERENT animals', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const first = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const second = combatantAtNode(sim, 40, 42, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, first, 40, 40, 12);
    bindFlagAtNode(sim, second, 40, 42, 12);
    // Both deer are in both hunters' bands, and this one is the nearer of the two for BOTH of them.
    const nearest = fighterAtNode(sim, 45, 41, DEER, null);
    const other = fighterAtNode(sim, 48, 41, DEER, null);

    combatSystem(sim.world, ctxOf(sim));

    // The colleague's committed animal is no candidate, so the herd is split rather than doubled up on.
    expect(sim.world.get(first, HuntFocus).target).toBe(nearest);
    expect(sim.world.get(second, HuntFocus).target).toBe(other);
    expect(sim.world.get(second, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: other });
  });

  it("a COLLEAGUE's kill neither gates this hunter's hunting nor is left ownerless when its killer dies", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const colleague = combatantAtNode(sim, 41, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    bindFlagAtNode(sim, colleague, 41, 40, 12); // overlapping grounds - the carcass lies in both
    const deer = fighterAtNode(sim, 45, 40, DEER, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());
    sim.world.add(carcass, KilledBy, { by: colleague });

    combatSystem(sim.world, ctxOf(sim));

    // The one-kill gate is per hunter, not per ground: the colleague's body is not this hunter's work.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });

    // The claim dies with its killer, or no kill made by a hunter that falls could ever be banked.
    sim.world.destroy(colleague);
    removeCurrentAtomic(sim.world, hunter);
    sim.world.remove(hunter, HuntFocus);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // gated again - the body is now its own work
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('an in-ground carcass the hunter remembers as UNREACHABLE does not gate new kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    stampResourceFootprintData(sim.world, carcass, anchorOnlyFootprint());
    // The harvest drive's route to it just failed (an overlay-boxed kill): the memo veto must keep the
    // one-kill gate from out-claiming work nobody can bank - the hunter goes on hunting.
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    noteUnreachableGoal(sim.world, ctxOf(sim), hunter, terrain.nodeAt(38, 40));

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });
});
