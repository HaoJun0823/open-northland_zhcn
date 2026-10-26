import { describe, expect, it } from 'vitest';
import type { DiagEntry } from '../../../src/diag/log.js';
import { gzipSize } from '../../../src/diag/report/gzip.js';
import { cutLog } from '../../../src/diag/report/log-cut.js';
import { NO_SECRETS } from '../../../src/diag/report/redact.js';
import { jsonShape, shapeWeight } from '../../../src/diag/report/shape.js';

const STACK = Array.from(
  { length: 24 },
  (_, i) => `    at frame${i} (https://game.example/assets/index.js:1:${i})`,
).join('\n');

describe('report log cut', () => {
  it('keeps the oldest and newest entries of an error storm within both its gzip and inflated budgets', async () => {
    // One error repeated: gzip folds it to almost nothing, so the inflated size is what binds.
    const entries: DiagEntry[] = Array.from({ length: 4000 }, (_, i) => ({
      timeMs: i,
      channel: 'crash',
      level: 'error',
      message: 'TypeError: x is undefined',
      data: { stack: STACK },
    }));
    const budget = { maxEntries: 1000, gzipBytes: 24 * 1024, inflatedBytes: 256 * 1024 };
    const log = await cutLog(entries, budget, NO_SECRETS);

    expect(log.entries.length).toBeLessThan(1000);
    expect(log.entries[0]?.timeMs).toBe(0);
    expect(log.entries.at(-1)?.timeMs).toBe(3999);
    expect(log.dropped).toBe(entries.length - log.entries.length);
    expect(shapeWeight(jsonShape(JSON.stringify(log.entries)))).toBeLessThanOrEqual(budget.inflatedBytes);
    expect(await gzipSize(log.entries)).toBeLessThanOrEqual(budget.gzipBytes);
  });

  it('turns log data nested past the free-form depth into text', async () => {
    let deep: unknown = 'bottom';
    for (let level = 0; level < 20; level++) deep = { level, deep };
    const log = await cutLog(
      [{ timeMs: 0, channel: 'net', level: 'info', message: 'deep', data: deep }],
      { maxEntries: 10, gzipBytes: 1024, inflatedBytes: 64 * 1024 },
      NO_SECRETS,
    );
    // Document, log, entries and entry hold the data four levels down.
    expect(jsonShape(JSON.stringify({ log: { entries: log.entries } })).depth).toBeLessThanOrEqual(16);
  });
});
