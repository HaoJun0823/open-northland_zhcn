import { describe, expect, it } from 'vitest';
import { Building, Position, Settler } from '../../../../src/components/index.js';

import { fresh, HEADQUARTERS, nthEntity, VIKING, WOODCUTTER } from './support.js';

describe('CommandSystem - dispatch and logging', () => {
  it('records applied commands in the log stamped with the tick they were applied on', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.step(); // tick 1
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING });
    sim.step(); // tick 2

    const log = sim.commands.log;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ applyTick: 1, sequence: 0, command: { kind: 'spawnSettler' } });
    expect(log[1]).toMatchObject({ applyTick: 2, sequence: 1, command: { kind: 'placeBuilding' } });
  });

  it('applies commands in FIFO enqueue order within one tick', () => {
    const sim = fresh();
    // Two placements; the entity ids must reflect enqueue order (first enqueued = lower id).
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 6, y: 0, tribe: VIKING });
    sim.step();

    expect([...sim.world.query(Position)]).toHaveLength(2);
    // First enqueued (the building) got the lower id.
    expect(sim.world.has(nthEntity(sim, 0), Building)).toBe(true);
    expect(sim.world.has(nthEntity(sim, 1), Settler)).toBe(true);
  });
});
