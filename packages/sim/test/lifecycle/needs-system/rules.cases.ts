import { describe, expect, it } from 'vitest';
import { fx, Simulation } from '../../../src/index.js';
import { NEED_DRAIN_UNITS_PER_TICK, needBar } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { needsOf } from '../../fixtures/settler.js';
import { settlerWithHunger } from './support.js';

describe('needsSystem - the setNeedsEnabled world rule (the dev/admin toggle)', () => {
  it('freezes every need while disabled and resumes on re-enable', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < 50; i++) sim.step();
    const frozen = needsOf(sim, e);
    expect(frozen.hunger).toBe(fx.fromInt(0));
    expect(frozen.fatigue).toBe(fx.fromInt(0));
    expect(frozen.piety).toBe(fx.fromInt(0));
    expect(frozen.enjoyment).toBe(fx.fromInt(0));

    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    sim.step(); // the toggle applies (commandSystem) before needsSystem the same tick
    expect(needsOf(sim, e).hunger).toBe(needBar(NEED_DRAIN_UNITS_PER_TICK));
    expect(sim.checkInvariants()).toEqual([]);
  });
});
