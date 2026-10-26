import { describe, expect, it } from 'vitest';
import type { DiagEntry } from '../../../src/diag/log.js';
import { gzipSize } from '../../../src/diag/report/gzip.js';
import { cutLog } from '../../../src/diag/report/log-cut.js';

describe('report log cut', () => {
  it('keeps the oldest and newest entries within the count and the gzip budget, counting the rest', async () => {
    const entries: DiagEntry[] = Array.from({ length: 4000 }, (_, i) => ({
      timeMs: i,
      channel: 'sim',
      level: 'info',
      message: `step ${i} ${((i * 2_654_435_761) % 4_294_967_296).toString(36)}`,
      data: { i },
    }));
    const budget = 8 * 1024;
    const log = await cutLog(entries, 1000, budget, []);

    expect(log.entries.length).toBeLessThan(1000);
    expect(log.entries[0]?.timeMs).toBe(0);
    expect(log.entries.at(-1)?.timeMs).toBe(3999);
    expect(log.dropped).toBe(entries.length - log.entries.length);
    expect(await gzipSize(log.entries)).toBeLessThanOrEqual(budget);
  });
});
