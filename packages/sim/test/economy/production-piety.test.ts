import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  JobAssignment,
  Position,
  Production,
  Resting,
  Stockpile,
  setNeedsEnabled,
} from '../../src/components/index.js';
import { exportSaveGame, fx, ONE, restoreSimulation, Simulation } from '../../src/index.js';
import { atomicSystem, needBar, productionSystem } from '../../src/systems/index.js';
import { startCraftAtomic } from '../../src/systems/settlers/drives/economy/workshop/craft.js';
import { testContent } from '../fixtures/content.js';
import { nextTickCtxOf } from '../fixtures/context.js';
import { needsOf, setNeeds } from '../fixtures/settler.js';
import {
  CARPENTER,
  CYCLE_TICKS,
  ctxOf,
  PLANK,
  sawmill,
  spawnSettler,
  WOOD,
} from './production-system/support.js';

/** The forge clip's `event <at> 4 <delta>`, the religion the maker spends on one item - the shape every
 *  weapon and armour `..._produce_*` clip carries, where the plain rows spend 1500 and the heavy ones 3000. */
const FORGE_ATOMIC = 69;
const FORGE_PIETY_UNITS = -1500;

// Religion (piety) is spent only on forging a weapon or piece of armor. The fixture sawmill turns wood
// into plank; declaring PLANK a weapon good (a WeaponType with `goodType: PLANK`) and binding the carpenter
// a forge clip makes the sawmill stand in for a smithy on the shared production fixture.
function contentWithMilitaryPlank(pietyUnits = FORGE_PIETY_UNITS) {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: base.goods.map((g) => (g.typeId === PLANK ? { ...g, atomics: { produce: FORGE_ATOMIC } } : g)),
    weapons: [...base.weapons, { typeId: 99, id: 'test_forged_plank', tribeType: 1, goodType: PLANK }],
    tribes: base.tribes.map((t) =>
      t.typeId === 1
        ? {
            ...t,
            atomicBindings: [
              ...t.atomicBindings,
              { jobType: CARPENTER, atomicId: FORGE_ATOMIC, animation: 'viking_forge' },
            ],
          }
        : t,
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_forge',
        name: 'viking_forge',
        length: 4,
        events: [
          { at: 2, type: 4, value: pietyUnits },
          { at: 2, type: 1, value: -100 },
          { at: 2, type: 2, value: -100 },
        ],
      },
    ],
  });
}

describe('productionSystem - forging a military good charges the smith piety', () => {
  it('raises the operator piety by what its own forge clip spends per completed cycle', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    // One full cycle to completion (CYCLE_TICKS-th advance deposits the output on tick CYCLE_TICKS+1).
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(needBar(-FORGE_PIETY_UNITS));
  });

  it('leaves piety untouched for a non-military output (a plain plank)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(fx.fromInt(0));
  });

  it('clamps piety at ONE across many forged cycles', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 40]]); // 40 cycles × 10% would overflow without the clamp
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t < CYCLE_TICKS * 40 + 5; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(ONE);
  });

  it('spends what the heavier item costs when its clip says so', () => {
    const HEAVY_PIETY_UNITS = -3000;
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(HEAVY_PIETY_UNITS) });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(needBar(-HEAVY_PIETY_UNITS));
  });
});

describe('production events share the batch clock with the displayed craft', () => {
  it.each([1500, 3000])(
    'charges %i on the authored frame only, across display replans and completion',
    (cost) => {
      const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(-cost) });
      const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
      if (worker === null) throw new Error('missing maker');
      sim.world.add(worker, Resting, { at: mill });
      productionSystem(sim.world, nextTickCtxOf(sim));
      for (let frame = 1; frame <= 4; frame++) {
        const ctx = nextTickCtxOf(sim);
        startCraftAtomic(sim.world, ctx, worker, mill, 0);
        atomicSystem(sim.world, ctx);
        productionSystem(sim.world, ctx);
        expect(needsOf(sim, worker).piety).toBe(frame < 2 ? 0 : needBar(cost));
        expect(needsOf(sim, worker).hunger).toBe(frame < 2 ? 0 : needBar(100));
        expect(needsOf(sim, worker).fatigue).toBe(frame < 2 ? 0 : needBar(50));
      }
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    },
  );

  it.each([1, 2])(
    'resumes after frame %i with another worker without replaying paid events, including a saved batch',
    (frame) => {
      const content = contentWithMilitaryPlank();
      const sim = new Simulation({ seed: 1, content });
      const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
      if (worker === null) throw new Error('missing maker');
      productionSystem(sim.world, nextTickCtxOf(sim));
      for (let i = 0; i < frame; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      sim.world.remove(worker, JobAssignment);
      sim.world.mut(worker, Position).x = fx.fromInt(8);
      for (let i = 0; i < 3; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(mill, Production).cycles[0]?.elapsed).toBe(frame);
      const replacement = spawnSettler(sim, CARPENTER, 0, 0);
      sim.world.add(replacement, JobAssignment, { workplace: mill });
      const restored = restoreSimulation(exportSaveGame(sim), { content });
      for (const run of [sim, restored]) {
        for (let i = frame; i < 4; i++) productionSystem(run.world, nextTickCtxOf(run));
        expect(needsOf(run, worker).piety).toBe(frame >= 2 ? needBar(1500) : 0);
        expect(needsOf(run, replacement).piety).toBe(frame < 2 ? needBar(1500) : 0);
        expect(run.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
      }
    },
  );

  it('does not charge frozen needs while the batch continues', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('missing maker');
    setNeedsEnabled(sim.world, false);
    for (let i = 0; i < 5; i++) productionSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(0);
  });
});
