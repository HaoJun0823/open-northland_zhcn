import { describe, expect, it } from 'vitest';
import { Position, Stockpile } from '../../src/components/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { Simulation } from '../../src/simulation.js';
import { collectTargets, storeHoldingMayLieIn } from '../../src/systems/settlers/targets/index.js';
import { signpostLinksSystem } from '../../src/systems/signposts/links.js';
import { createSignpost } from '../../src/systems/signposts/placement.js';
import { collectSupplyTally } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const PLAYER = 0;
const GOOD = 1;

describe('a store search inside a goods gate', () => {
  it('is proven empty when every holder of the good is filed beyond the gate', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(160, 60) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const here = terrain.nodeAt(20, 30);
    createSignpost(sim.world, terrain, here, PLAYER, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const goods = sim.world.create();
    sim.world.add(goods, Position, positionOfNode(150, 30));
    sim.world.add(goods, Stockpile, { amounts: new Map([[GOOD, 5]]) });
    const mayLie = (): boolean => {
      const { bands } = collectTargets(sim.world, ctxOf(sim), terrain);
      const area = bands.goodsGate(here, PLAYER);
      return storeHoldingMayLieIn(bands, sim.world, GOOD, PLAYER, collectSupplyTally(sim.world), area);
    };
    expect(mayLie()).toBe(false);

    sim.world.add(goods, Position, positionOfNode(30, 30));
    expect(mayLie()).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
