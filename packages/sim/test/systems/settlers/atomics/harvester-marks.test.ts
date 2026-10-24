import { describe, expect, it } from 'vitest';
import { HarvestedBy } from '../../../../src/components/index.js';
import { positionOfNode, Simulation } from '../../../../src/index.js';
import { dropGroundPile } from '../../../../src/systems/settlers/atomics/effects/goods/piles.js';
import { collectTargets } from '../../../../src/systems/settlers/targets/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

const WOOD = 1;

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(32, 16) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const pile = (hx: number) => {
    const at = positionOfNode(hx, 4);
    return dropGroundPile(sim.world, at.x, at.y, WOOD, 1);
  };
  return { sim, pile, pass: () => collectTargets(sim.world, ctxOf(sim), terrain) };
}

describe("ownDropsOf - a harvester's own drops from the marks kept across ticks", () => {
  it('follows marks set, moved and lifted between passes', () => {
    const { sim, pile, pass } = fixture();
    const [a, b] = [sim.world.create(), sim.world.create()];
    const piles = [pile(2), pile(6), pile(10)];
    const [first, second, third] = piles;
    if (first === undefined || second === undefined || third === undefined) throw new Error('piles missing');
    for (const p of piles) sim.world.add(p, HarvestedBy, { by: a });
    expect(pass().ownDropsOf(a)).toEqual(piles);
    sim.world.remove(first, HarvestedBy);
    sim.world.mut(second, HarvestedBy).by = b;
    sim.world.destroy(third);
    const next = pass();
    expect(next.ownDropsOf(a)).toBeUndefined();
    expect(next.ownDropsOf(b)).toEqual([second]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
