import { describe, expect, it } from 'vitest';
import { EquipOrder, Owner, setSettlerJob } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { equipFetchesUnderway } from '../../src/systems/settlers/drives/equip-fetches.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';

const WOODCUTTER = 1;
const AXE = 7;
const BOOTS = 8;
const PLAYER = 0;
const RIVAL = 1;

function fetcher(sim: Simulation, goodType: number): Entity {
  const e = settlerAt(sim, { jobType: WOODCUTTER });
  sim.world.add(e, Owner, { player: PLAYER });
  sim.world.add(e, EquipOrder, {
    group: 'tool',
    slot: 0,
    goodType,
    returnTo: null,
    stage: 'acquire',
    issuer: 'assistant-grant',
    queued: [],
  });
  return e;
}

const totals = (sim: Simulation) => equipFetchesUnderway(sim.world);

describe('equipFetchesUnderway', () => {
  it('follows the stage, job, owner and removal of each errand', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const first = fetcher(sim, AXE);
    const second = fetcher(sim, AXE);
    fetcher(sim, BOOTS);
    expect(totals(sim)).toEqual(
      new Map([
        [
          PLAYER,
          new Map([
            [AXE, 2],
            [BOOTS, 1],
          ]),
        ],
      ]),
    );

    sim.world.mut(first, EquipOrder).stage = 'return';
    setSettlerJob(sim.world, second, null);
    expect(totals(sim)).toEqual(new Map([[PLAYER, new Map([[BOOTS, 1]])]]));

    setSettlerJob(sim.world, second, WOODCUTTER);
    sim.world.mut(second, Owner).player = RIVAL;
    sim.world.remove(first, EquipOrder);
    expect(totals(sim)).toEqual(
      new Map([
        [PLAYER, new Map([[BOOTS, 1]])],
        [RIVAL, new Map([[AXE, 1]])],
      ]),
    );
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('hands each caller its own copy', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    fetcher(sim, AXE);
    totals(sim).get(PLAYER)?.set(AXE, 5);
    expect(totals(sim).get(PLAYER)?.get(AXE)).toBe(1);
  });
});
