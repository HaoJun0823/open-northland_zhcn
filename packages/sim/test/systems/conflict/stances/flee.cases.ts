import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Fleeing,
  PathFollow,
  PathRoute,
  Position,
} from '../../../../src/components/index.js';
import { fx, ONE } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { type NodeId, Simulation } from '../../../../src/index.js';
import { FLEE_STEP_NODES } from '../../../../src/systems/conflict/flee.js';
import { combatSystem } from '../../../../src/systems/index.js';
import { movementSystem } from '../../../../src/systems/movement/system.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { resolveCombatHit } from '../../../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { hexNodeDistance } from '../../../../src/systems/spatial/metric.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { spawnSettler } from '../../../../src/systems/spawn/index.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import { setNeeds } from '../../../fixtures/settler.js';
import { combatant, ctxOf, grassMap, P0, P1, VIKING, WOOD, WOODCUTTER } from './support.js';

/** The fixture scout trade, a raider who strikes by hand. */
const SCOUT = 27;
const BLOW = { damage: 10 };
/** Ticks watched: long enough for a run to end and a worker to settle back to its drives. */
const WATCH_TICKS = 160;

/** A woodcutter of `P0` spawned at visual cell (x, 0), stamped with its seat's default stance. */
function civilianAt(sim: Simulation, x: number): Entity {
  const e = spawnSettler(sim.world, ctxOf(sim), {
    kind: 'spawnSettler',
    jobType: WOODCUTTER,
    x,
    y: 0,
    tribe: VIKING,
    owner: P0,
  });
  if (e === null) throw new Error('spawn refused');
  return e;
}

function distance(sim: Simulation, a: Entity, b: Entity): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return hexNodeDistance(terrain, entityNode(sim.world, terrain, a), entityNode(sim.world, terrain, b));
}

describe('civilians run from a blow, never from the sight of an enemy', () => {
  it('a civilian keeps to its work beside an idle enemy scout in sight', () => {
    // A worker never runs at the sight of an enemy, so a scout standing by cannot drive it back and forth.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = civilianAt(sim, 20);
    combatant(sim, 23, 0, P1, MILITARY_MODE.IGNORE, { jobType: SCOUT });
    sim.world.add(civ, Carrying, { goodType: WOOD, amount: 1 });

    for (let t = 0; t < WATCH_TICKS; t++) {
      sim.step();
      expect(sim.world.has(civ, Fleeing)).toBe(false);
    }
    expect(sim.world.tryGet(civ, CurrentAtomic)?.effect.kind).not.toBe('drop');
  });

  it('a struck civilian runs once and stays calm beside the striker afterwards', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = civilianAt(sim, 20);
    const raider = combatant(sim, 21, 0, P1, MILITARY_MODE.IGNORE, { jobType: SCOUT });

    resolveCombatHit(sim.world, ctxOf(sim), raider, civ, BLOW, [], 'melee');
    combatSystem(sim.world, ctxOf(sim)); // the pass that answers the blow's alarm
    let runs = 0;
    let running = false;
    for (let t = 0; t < WATCH_TICKS; t++) {
      sim.step();
      const now = sim.world.has(civ, Fleeing);
      if (now && !running) runs++;
      running = now;
    }

    expect(runs).toBe(1);
    expect(running).toBe(false);
    expect(distance(sim, civ, raider)).toBeGreaterThan(FLEE_STEP_NODES / 2);
  });

  it('a struck civilian whose need is collapsing stands to eat or sleep', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.IGNORE);
    const raider = combatant(sim, 21, 0, P1, MILITARY_MODE.IGNORE, { jobType: SCOUT });
    setNeeds(sim, civ, { hunger: ONE });

    resolveCombatHit(sim.world, ctxOf(sim), raider, civ, BLOW, [], 'melee');
    combatSystem(sim.world, ctxOf(sim)); // the pass that answers the blow's alarm
    sim.step();

    expect(sim.world.has(civ, Fleeing)).toBe(false);
  });
});

describe('a runner moves at its normal pace (no sprint exists)', () => {
  it('a Fleeing path-follower walks at the same step cost as a calm one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const stop = { x: fx.fromFloat(0.5), y: fx.fromInt(0), node: sim.terrain?.nodeAt(1, 0) ?? (0 as NodeId) };
    const walker = sim.world.create();
    sim.world.add(walker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(walker, PathRoute, { waypoints: [{ ...stop }] });
    sim.world.add(walker, PathFollow, { index: 0, legElapsed: 0, legCost: 0 });
    const runner = sim.world.create();
    sim.world.add(runner, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(runner, PathRoute, { waypoints: [{ ...stop }] });
    sim.world.add(runner, PathFollow, { index: 0, legElapsed: 0, legCost: 0 });
    sim.world.add(runner, Fleeing, {});

    // Fleeing grants no speed boost: both read the same step cost and advance step-for-step alike.
    movementSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(runner, PathFollow).legCost).toBe(sim.world.get(walker, PathFollow).legCost);
    expect(sim.world.get(runner, Position).x).toBe(sim.world.get(walker, Position).x);
    // Both turn from the default SW facing before translating. The last turn tick starts the step.
    movementSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(runner, Position).x).toBe(sim.world.get(walker, Position).x);
    movementSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(runner, Position).x).toBe(sim.world.get(walker, Position).x);
    expect(sim.world.get(runner, Position).x).toBeGreaterThan(fx.fromInt(0));
  });
});
