import { expect, it, vi } from 'vitest';
import { Owner } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { hexagonRing } from '../../src/nav/halfcell.js';
import { MeleeSlots } from '../../src/systems/conflict/melee-slots.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  OTHER,
  SOLDIER_SWORD_SHORT,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

it('shares full waiting rows instead of scanning the whole crowd for every waiting soldier', () => {
  const checks = [100, 200, 400].map((count) => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');
    const centre = { hx: 30, hy: 30 };
    const target = fighterAtNode(sim, centre.hx, centre.hy, OTHER, WOMAN);
    const positions = [];
    for (let radius = 1; positions.length < count; radius++) {
      for (const { point } of hexagonRing(centre, radius)) {
        const e = fighterAtNode(sim, point.hx, point.hy, VIKING, SOLDIER_SWORD_SHORT);
        sim.world.add(e, Owner, { player: 0 });
        positions.push({ node: terrain.nodeAt(point.hx, point.hy), radius });
        if (positions.length === count) break;
      }
    }
    const slots = new MeleeSlots(sim.world, ctxOf(sim), terrain);
    const taken = vi.spyOn(slots, 'isTaken');
    try {
      for (const { node, radius } of positions) {
        if (radius === 1) continue;
        expect(
          slots.waitingCell(
            node,
            { entity: target, node: terrain.nodeAt(centre.hx, centre.hy), body: null },
            { minRange: 1, maxRange: 1 },
            { goal: undefined, standingOn: node },
          ),
        ).toBe(node);
        slots.claim(node, 0);
      }
      return taken.mock.calls.length;
    } finally {
      taken.mockRestore();
    }
  });
  expect(checks[2]).toBeLessThan((checks[0] ?? 0) * 6);
  expect(checks[2]).toBeLessThan(400 * 12);
});
