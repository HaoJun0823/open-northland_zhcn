import { jobCanPray, resolveJobAtomics } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('religion over generated content', () => {
  it('resolves the mismatched production rows through the maker and retains the authored cost', async () => {
    const { real } = await loadContentUnderTest();
    for (const [ware, job, action, cost] of [
      ['spear_wooden', 'joiner', 67, -1500],
      ['tool_iron', 'smith', 60, 0],
    ] as const) {
      const good = real.goods.find((row) => row.id === ware);
      const maker = real.jobs.find((row) => row.id === job);
      if (good === undefined || maker === undefined) throw new Error(`missing ${ware}/${job}`);
      const settler = { tribe: 1, jobType: maker.typeId };
      const atomic = systems.productionAtomic(real, settler, good.typeId);
      expect(atomic).toBe(action);
      expect(resolveJobAtomics(real.jobs).get(maker.typeId)?.has(action)).toBe(true);
      const name = systems.atomicClipName(real, settler, action);
      if (name === undefined) throw new Error(`unbound ${ware}`);
      expect(systems.atomicEventChannelDelta(real, name, 4)).toBe(cost);
    }
  });

  it('allows manual prayer independently of the autonomous religion flag', async () => {
    const { real } = await loadContentUnderTest();
    for (const name of ['joiner', 'armorer', 'smith', 'sewer', 'civilist']) {
      const job = real.jobs.find((row) => row.id === name);
      expect(jobCanPray(real.jobs, job?.typeId ?? null), name).toBe(true);
    }
    for (const job of real.jobs.filter((row) => row.id === 'woman' || row.id.startsWith('soldier_'))) {
      expect(jobCanPray(real.jobs, job.typeId), job.id).toBe(false);
    }
  });
});
