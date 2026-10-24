import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { GOOD_GOLD, GOOD_IRON } from '../../../src/game/sandbox/index.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { sandboxScene } from '../../../src/scenes/sandbox/index.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

const { Resource } = components;

/** Five minutes of game time: several dig cycles per camp. */
const DIG_TICKS = 3600;

/** Total units still standing in `good`'s resource nodes. */
function remaining(sim: ReturnType<typeof createSceneSim>, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Resource)) {
    const r = sim.world.get(e, Resource);
    if (r.goodType === good) total += r.remaining;
  }
  return total;
}

/**
 * Real content gates iron/gold harvesting behind clay/stone-digging XP (`needforgood 6/7 10` over the
 * collector's mud/stone tracks) - a gate the synthetic sandbox content doesn't carry, so only this
 * real-content twin can prove the sandbox camps still work under it. The scene's collectors spawn as
 * veterans (`gatherMasteryExperience`); without that stamp a fresh collector pinned to an iron camp
 * fails `settlerMeetsNeed` forever and stands idle beside its deposit.
 */
describe.runIf(hasRealIr())('sandbox scene on real content - gathering XP gates', () => {
  it('the iron and gold camps are actually mined (veteran collectors pass needforgood)', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(sandboxScene, { content: merge.content });
    const iron = remaining(sim, GOOD_IRON);
    const gold = remaining(sim, GOOD_GOLD);
    sim.run(DIG_TICKS);
    expect(remaining(sim, GOOD_IRON)).toBeLessThan(iron);
    expect(remaining(sim, GOOD_GOLD)).toBeLessThan(gold);
    // Tens of seconds alone; the budget is a hang guard for a CPU-contended parallel run.
  }, 300_000);
});
