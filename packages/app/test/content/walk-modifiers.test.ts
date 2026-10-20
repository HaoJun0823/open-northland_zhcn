import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('real-content human walking', () => {
  it('preserves engine tribe/job reductions through the runtime merge', async () => {
    const { real, merge } = await loadContentUnderTest();
    for (const content of [real, merge.content]) {
      expect(content.tribes.find((t) => t.typeId === 3)?.walkStepReduction).toEqual({
        ticks: 2,
        jobType: 32,
      });
      expect(content.tribes.find((t) => t.typeId === 7)?.walkStepReduction).toEqual({ ticks: 2 });
      expect(content.tribes.find((t) => t.typeId === 1)?.walkStepReduction).toBeUndefined();
    }
  });
});
