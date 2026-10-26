// @vitest-environment jsdom
import { REPORT_UPLOAD_LIMITS, type ReportPart } from '@open-northland/data';
import type { LoggedCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { decodeUpload } from '../../../../api/src/reports/decode.js';
import { diag } from '../../../src/diag/index.js';
import { LIGHT_REPORT_BUDGET_BYTES } from '../../../src/diag/report/budget.js';
import { buildReportDraft } from '../../../src/diag/report/build.js';
import { ReportCase } from '../../../src/diag/report/case.js';
import { fitCommands, fittedReport } from '../../../src/diag/report/fit.js';
import { gzipSize } from '../../../src/diag/report/gzip.js';
import { jsonShape, shapeFits } from '../../../src/diag/report/shape.js';

const STACK = Array.from(
  { length: 30 },
  (_, i) => `    at frame${i} (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:1:${i})`,
).join('\n');

describe('report fit', () => {
  it('keeps the newest commands and the tick they are complete from when the whole log is over budget', async () => {
    const { report } = await buildReportDraft(null);
    // Each command carries its own noise, so gzip cannot fold the log away.
    const logged = Array.from({ length: 40_000 }, (_, i) => ({
      applyTick: Math.floor(i / 4),
      sequence: i,
      by: 'admin',
      command: { kind: 'noise', value: ((i * 2_654_435_761) % 4_294_967_296).toString(36) },
    }));
    const slice = { commands: logged as never[], fromTick: 0, whole: true };

    const fitted = await fitCommands(report, slice, LIGHT_REPORT_BUDGET_BYTES);

    expect(fitted).not.toBeNull();
    if (fitted === null) return;
    expect(fitted.whole).toBe(false);
    expect(fitted.commands.at(-1)).toBe(logged.at(-1));
    expect(fitted.commands.every((command) => command.applyTick >= fitted.fromTick)).toBe(true);
    expect(logged.filter((command) => command.applyTick >= fitted.fromTick)).toHaveLength(
      fitted.commands.length,
    );
    const size = await gzipSize({ ...report, attachments: { commands: fitted.commands } });
    expect(size).toBeLessThanOrEqual(LIGHT_REPORT_BUDGET_BYTES);
  });

  it('posts an error storm with a long, repetitive command log as a part the API stores', async () => {
    // A storm of one error with a 2 KB stack, and one entry nested deeper than the API parses.
    for (let i = 0; i < 4000; i++) diag.error('crash', 'TypeError: x is undefined', { stack: STACK });
    let deep: unknown = 'bottom';
    for (let level = 0; level < 20; level++) deep = [deep];
    diag.info('net', 'deep', { deep });
    const draft = await buildReportDraft({
      trigger: 'error',
      error: { thread: 'main', name: 'TypeError', message: 'x is undefined', stack: STACK },
    });
    // Commands alike enough that gzip folds megabytes of them under the light budget.
    const logged = Array.from({ length: 150_000 }, (_, i) => ({
      applyTick: Math.floor(i / 3),
      sequence: i,
      by: 'seat:0',
      command: { kind: 'move', units: [1, 2, 3], to: { x: 10, y: 20 } },
    })) as unknown as LoggedCommand[];
    const posted: { part: ReportPart; body: Uint8Array }[] = [];
    const kase = new ReportCase(
      () => ({
        deliver: async (entry) => {
          posted.push({ part: entry.part, body: entry.body });
          return { kind: 'sent' };
        },
        queue: async () => undefined,
        now: () => 0,
      }),
      false,
    );
    await kase.prepare(
      { ...draft, commands: { commands: logged, fromTick: 0, whole: true } },
      { settings: { value: { language: 'eng' }, bytes: 40 }, screenshot: null, save: null },
    );
    await kase.sendFromPlayer({
      comment: 'ł'.repeat(4000),
      contact: 'someone@example.org',
      include: { commands: true, settings: true, screenshot: false, save: false },
    });

    const [report] = posted;
    expect(report?.part).toBe('report');
    if (report === undefined) return;
    expect(report.body.byteLength).toBeLessThanOrEqual(REPORT_UPLOAD_LIMITS.report.bytes);
    const decoded = decodeUpload(report.body, 'report', REPORT_UPLOAD_LIMITS.report.inflatedBytes);
    expect(decoded.part).toBe('report');
    expect(kase.delivery).toBe('sent');
  });

  it('cuts an oversized part by its commands first, then by its log', async () => {
    const { report } = await buildReportDraft(null);
    const entry = { timeMs: 0, channel: 'crash', level: 'error' as const, message: 'x', data: STACK };
    const commands = Array.from({ length: 40_000 }, (_, i) => ({ applyTick: i, by: 'seat:0', kind: 'x' }));
    const fitted = await fittedReport({
      ...report,
      log: { entries: Array.from({ length: 2000 }, () => entry), dropped: 0 },
      attachments: { commands, commandsFromTick: 0 },
    });

    expect(fitted).not.toBeNull();
    if (fitted === null) return;
    expect(fitted.report.attachments?.commands).toBeUndefined();
    expect(fitted.report.log.entries.length).toBeLessThan(2000);
    expect(fitted.report.log.dropped).toBe(2000 - fitted.report.log.entries.length);
    expect(shapeFits(jsonShape(JSON.stringify(fitted.report)), 'report')).toBe(true);
  });
});
