import { describe, expect, it } from 'vitest';
import { Age, AttackOrder, Health, Owner, Settler } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { isValidOrderedTarget, isValidTarget } from '../../../src/systems/conflict/targeting.js';
import { ADULT_AGE_TICKS, CHILD_AGE_TICKS, growthSystem } from '../../../src/systems/lifecycle/ageclass.js';
import { attackUnit } from '../../../src/systems/orders/combat.js';
import { resolveCombatHit } from '../../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  OTHER,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

function setup(jobType: number, ticks: number) {
  const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(6, 6) });
  const attacker = fighterAtNode(sim, 4, 4, VIKING, WOMAN);
  const child = fighterAtNode(sim, 5, 4, OTHER, jobType, { hitpoints: 100 });
  sim.world.add(attacker, Owner, { player: 0 });
  sim.world.add(child, Owner, { player: 1 });
  sim.world.add(child, Age, { ticks, asOf: null });
  return { sim, attacker, child };
}

describe('child immunity', () => {
  for (const jobType of [1, 2, 3, 4]) {
    it(`protects age class ${jobType} from targeting and every combat hit source`, () => {
      const { sim, attacker, child } = setup(jobType, jobType < 3 ? 0 : CHILD_AGE_TICKS);
      const ctx = ctxOf(sim);
      const identity = sim.world.get(attacker, Settler);
      expect(isValidTarget(sim.world, ctx, attacker, identity, child)).toBe(false);
      expect(isValidOrderedTarget(sim.world, ctx, attacker, identity, child)).toBe(false);
      attackUnit(sim.world, ctx, { kind: 'attackUnit', entity: attacker, target: child });
      expect(sim.world.has(attacker, AttackOrder)).toBe(false);
      for (const source of ['melee', 'projectile', 'collateral'] as const) {
        expect(resolveCombatHit(sim.world, ctx, attacker, child, { damage: 1000 }, [], source)).toBeNull();
      }
      expect(sim.world.get(child, Health).hitpoints).toBe(100);
      sim.run(1);
      expect(sim.world.isAlive(child)).toBe(true);
      expect(sim.world.get(child, Health).hitpoints).toBe(100);
    });
  }

  it.each([3, 4])('allows injuries as soon as child job %i grows into an adult', (jobType) => {
    const { sim, attacker, child } = setup(jobType, ADULT_AGE_TICKS - 1);
    const ctx = ctxOf(sim);
    expect(resolveCombatHit(sim.world, ctx, attacker, child, { damage: 1000 }, [], 'melee')).toBeNull();
    growthSystem(sim.world, ctx);
    expect(sim.world.has(child, Age)).toBe(false);
    expect(isValidTarget(sim.world, ctx, attacker, sim.world.get(attacker, Settler), child)).toBe(true);
    expect(isValidOrderedTarget(sim.world, ctx, attacker, sim.world.get(attacker, Settler), child)).toBe(
      true,
    );
    expect(resolveCombatHit(sim.world, ctx, attacker, child, { damage: 1000 }, [], 'melee')).not.toBeNull();
    expect(sim.world.get(child, Health).hitpoints).toBe(0);
  });
});
