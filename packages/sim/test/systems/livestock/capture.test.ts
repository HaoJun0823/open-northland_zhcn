import { describe, expect, it } from 'vitest';
import {
  DraughtAnimal,
  FarmAnimal,
  HerdMember,
  MoveGoal,
  Owner,
  Position,
  Stockpile,
  setDiplomacyStance,
  setSettlerJob,
} from '../../../src/components/index.js';
import type { Entity, Simulation } from '../../../src/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { liveOffenders } from '../../../src/systems/conflict/offenders.js';
import { livestockCaptureSystem } from '../../../src/systems/index.js';
import { hasValidLeader } from '../../../src/systems/movement/herd-leader.js';
import { setAiControl } from '../../../src/systems/orders/ai.js';
import { settlerAt } from '../../fixtures/settler.js';
import {
  BEAR_TRIBE,
  COW_GOOD,
  cowAt,
  ctxOf,
  farmAt,
  livestockMap,
  livestockSim,
  SCOUT,
  scoutAt,
} from './support.js';

const P0 = 0;
const P1 = 1;
const P2 = 2;
/** The economy fixture's woodcutter - an owned civilian that must not claim. */
const WOODCUTTER = 1;

/** Runs one capture pass on a fresh event buffer and returns the thefts it reported. */
function capturePass(sim: Simulation) {
  sim.events.clear();
  livestockCaptureSystem(sim.world, ctxOf(sim));
  return sim.events.current().filter((ev) => ev.kind === 'livestockStolen');
}

function stepTo(sim: Simulation, e: Entity, hx: number, hy: number): void {
  const at = positionOfNode(hx, hy);
  const p = sim.world.mut(e, Position);
  p.x = at.x;
  p.y = at.y;
}

describe('livestock capture - a scout claims the catchable animals it passes', () => {
  it('claims an adjacent wild cow: Owner stamped, wild-herd follow dropped', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 11, 10);
    sim.world.add(cow, HerdMember, { leader: cow });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(P0);
    expect(sim.world.has(cow, HerdMember)).toBe(false);
  });

  it('reaches two map points out, but no farther', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const near = cowAt(sim, 12, 10); // two map points east
    const far = cowAt(sim, 13, 10); // three

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(near, Owner)?.player).toBe(P0);
    expect(sim.world.has(far, Owner)).toBe(false);
  });

  it('only the scout trade claims - an owned woodcutter on the same node does not', () => {
    const sim = livestockSim();
    const woodcutter = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(10, 10) });
    sim.world.add(woodcutter, Owner, { player: P0 });
    const cow = cowAt(sim, 10, 10);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, Owner)).toBe(false);
  });

  it('follows a trade change: a woodcutter retrained as a scout claims, a scout retrained away stops', () => {
    const sim = livestockSim();
    const woodcutter = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(10, 10) });
    sim.world.add(woodcutter, Owner, { player: P0 });
    const scout = scoutAt(sim, 30, 10, P1);
    cowAt(sim, 60, 40); // out of everyone's reach: the first pass builds the scout index
    livestockCaptureSystem(sim.world, ctxOf(sim));

    setSettlerJob(sim.world, woodcutter, SCOUT);
    setSettlerJob(sim.world, scout, WOODCUTTER);
    const first = cowAt(sim, 10, 10);
    const second = cowAt(sim, 30, 10);
    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Owner)?.player).toBe(P0);
    expect(sim.world.has(second, Owner)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("steals an enemy's stock as a reported theft, and leaves a neighbour's alone", () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const enemyCow = cowAt(sim, 10, 11, { owner: P1 });
    const neighbourCow = cowAt(sim, 11, 10, { owner: P2 });
    cowAt(sim, 9, 10); // wild: claimed without a theft
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    setDiplomacyStance(sim.world, P0, P2, 'neutral');

    const thefts = capturePass(sim);

    expect(sim.world.tryGet(enemyCow, Owner)?.player).toBe(P0);
    expect(sim.world.get(neighbourCow, Owner).player).toBe(P2);
    expect(thefts).toEqual([
      {
        kind: 'livestockStolen',
        animal: enemyCow,
        victim: P1,
        thief: scout,
        thiefPlayer: P0,
        at: { hx: 10, hy: 11 },
      },
    ]);
  });

  it('leaves its thief in the memory of a robbed computer seat', () => {
    const sim = livestockSim();
    setAiControl(sim.world, ctxOf(sim), { kind: 'setAiControl', player: P1, enabled: true });
    const scout = scoutAt(sim, 10, 10, P0);
    cowAt(sim, 10, 11, { owner: P1 });
    setDiplomacyStance(sim.world, P0, P1, 'enemy');

    capturePass(sim);

    expect(liveOffenders(sim.world, P1, sim.tick).map((o) => o.entity)).toEqual([scout]);
  });

  it("takes a stolen animal out of the enemy farm's herd and its row", () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P1, stock: [[COW_GOOD, 1]] });
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 10, 11, { owner: P1, farm });
    setDiplomacyStance(sim.world, P0, P1, 'enemy');

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cow, Owner).player).toBe(P0);
    expect(sim.world.has(cow, FarmAnimal)).toBe(false);
    expect(sim.world.get(farm, Stockpile).amounts.get(COW_GOOD) ?? 0).toBe(0);
  });

  it('claims only on reaching a new map point: an animal that walks up to a standing scout stays free', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    cowAt(sim, 60, 40); // out of reach: the pass runs only while livestock exists
    capturePass(sim);
    const cow = cowAt(sim, 11, 10);

    capturePass(sim);
    expect(sim.world.has(cow, Owner)).toBe(false);

    stepTo(sim, scout, 10, 11);
    capturePass(sim);
    expect(sim.world.tryGet(cow, Owner)?.player).toBe(P0);
  });

  it('a restored run claims on the same steps: a scout that has not moved since the save claims nothing', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    cowAt(sim, 60, 40); // out of reach: the pass runs only while livestock exists
    capturePass(sim);
    const cow = cowAt(sim, 11, 10);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: sim.content,
      map: livestockMap(),
    });
    expect(restored.hashState()).toBe(sim.hashState());

    capturePass(restored);
    expect(restored.world.has(cow, Owner)).toBe(false);
    stepTo(restored, scout, 10, 11);
    capturePass(restored);
    expect(restored.world.tryGet(cow, Owner)?.player).toBe(P0);
  });

  it('two enemy scouts standing by one animal do not trade it back and forth', () => {
    const sim = livestockSim();
    const first = scoutAt(sim, 10, 10, P0);
    scoutAt(sim, 12, 10, P1);
    const cow = cowAt(sim, 11, 10);
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    setDiplomacyStance(sim.world, P1, P0, 'enemy');
    capturePass(sim); // both claim on first sight; the higher id's claim stands

    expect(capturePass(sim)).toEqual([]);
    expect(sim.world.get(cow, Owner).player).toBe(P1);

    stepTo(sim, first, 10, 11);
    expect(capturePass(sim).map((ev) => ev.victim)).toEqual([P1]);
    expect(sim.world.get(cow, Owner).player).toBe(P0);
  });

  it('drops a claimed leader from its wild herd, leaving the followers to find a new one', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const leader = cowAt(sim, 11, 10);
    const followerA = cowAt(sim, 14, 10);
    const followerB = cowAt(sim, 15, 10);
    sim.world.add(leader, HerdMember, { leader });
    sim.world.add(followerA, HerdMember, { leader });
    sim.world.add(followerB, HerdMember, { leader });

    livestockCaptureSystem(sim.world, ctxOf(sim)); // only the leader is in contact

    expect(sim.world.tryGet(leader, Owner)?.player).toBe(P0);
    expect(sim.world.has(leader, HerdMember)).toBe(false);
    // No conga to the farm: the wild followers have no valid leader until the herding drive re-leads them.
    expect(hasValidLeader(sim.world, followerA)).toBe(false);
    expect(hasValidLeader(sim.world, followerB)).toBe(false);
  });

  it("a steal mid-walk drops a cart's recruitment and the walk to its door with it", () => {
    const sim = livestockSim();
    const cart = sim.world.create(); // any entity stands in for the cart: only the link is tested
    scoutAt(sim, 10, 10, P0);
    const recruit = cowAt(sim, 10, 11, { owner: P1 });
    sim.world.add(recruit, DraughtAnimal, { vehicle: cart });
    sim.world.add(recruit, MoveGoal, { cell: sim.terrain?.nodeAtClamped(20, 20) ?? 0 });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(recruit, Owner).player).toBe(P0);
    expect(sim.world.has(recruit, DraughtAnimal)).toBe(false);
    expect(sim.world.has(recruit, MoveGoal)).toBe(false);
  });

  it('never claims a non-catchable animal (the bear stays wild)', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const bear = cowAt(sim, 11, 10, { tribe: BEAR_TRIBE });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(bear, Owner)).toBe(false);
  });
});
