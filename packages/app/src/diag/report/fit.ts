/** A report's first part kept within what the API takes: the command log cut first, then the logs. */
import { type FullReport, REPORT_UPLOAD_LIMITS, type ReportLog } from '@open-northland/data';
import type { LoggedCommand } from '@open-northland/sim';
import { LIGHT_REPORT_BUDGET_BYTES, REPORT_INFLATED_BUDGET_BYTES } from './budget.js';
import { type CommandSlice, commandsAttachment, newestCommands } from './build.js';
import { canGzip, type GzipBytes, gzipText, gzipTextSize } from './gzip.js';
import { headAndTail } from './log-cut.js';
import { jsonShape, shapeFits, shapeWeight } from './shape.js';

/** A command budget is approached by rescaling, one gzip per pass. */
const FIT_PASSES = 4;
const FIT_MARGIN = 0.9;
/** Halving from the largest command log to none and then each log ring takes fewer passes. */
const SHRINK_PASSES = 48;

interface Measure {
  readonly gzip: number;
  readonly weight: number;
}

async function measure(value: unknown): Promise<Measure> {
  const text = JSON.stringify(value);
  return { gzip: await gzipTextSize(text), weight: shapeWeight(jsonShape(text)) };
}

const withCommands = (report: FullReport, slice: CommandSlice): FullReport => ({
  ...report,
  attachments: { ...report.attachments, ...commandsAttachment(slice) },
});

/**
 * The commands that keep `report` within `budgetBytes` gzipped and within the part's inflated
 * budget, the newest kept when the whole log does not fit; null when not one fits.
 */
export async function fitCommands(
  report: FullReport,
  slice: CommandSlice,
  budgetBytes: number = LIGHT_REPORT_BUDGET_BYTES,
): Promise<CommandSlice | null> {
  const base = await measure(report);
  const fits = (size: Measure): boolean =>
    size.gzip <= budgetBytes && size.weight <= REPORT_INFLATED_BUDGET_BYTES;
  let candidate = slice;
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    if (candidate.commands.length === 0) return null;
    const size = await measure(withCommands(report, candidate));
    if (fits(size)) return candidate;
    const roomGzip = budgetBytes - base.gzip;
    const roomWeight = REPORT_INFLATED_BUDGET_BYTES - base.weight;
    if (roomGzip <= 0 || roomWeight <= 0) return null;
    const share = Math.min(
      size.gzip > base.gzip ? roomGzip / (size.gzip - base.gzip) : 1,
      roomWeight / Math.max(1, size.weight - base.weight),
    );
    candidate = newestCommands(slice, Math.floor(candidate.commands.length * share * FIT_MARGIN));
  }
  const size = await measure(withCommands(report, candidate));
  return fits(size) && candidate.commands.length > 0 ? candidate : null;
}

function halvedLog(log: ReportLog): ReportLog | null {
  if (log.entries.length <= 1) return null;
  const { kept, dropped } = headAndTail(log.entries, Math.floor(log.entries.length / 2));
  return { entries: kept, dropped: log.dropped + dropped };
}

/** `report` one step smaller: half its commands, else half its log, else half the worker's. */
function shrunk(report: FullReport): FullReport | null {
  const { attachments } = report;
  const commands = attachments?.commands;
  if (attachments !== undefined && commands !== undefined && commands.length > 0) {
    const slice: CommandSlice = {
      // The commands are the logged ones `commandsAttachment` put there.
      commands: commands as unknown as readonly LoggedCommand[],
      fromTick: attachments.commandsFromTick ?? 0,
      whole: false,
    };
    const half = newestCommands(slice, Math.floor(commands.length / 2));
    if (half.commands.length > 0) return withCommands(report, half);
    const { commands: _commands, commandsFromTick: _from, ...rest } = attachments;
    return { ...report, attachments: rest };
  }
  const log = halvedLog(report.log);
  if (log !== null) return { ...report, log };
  const workerLog = report.workerLog === undefined ? null : halvedLog(report.workerLog);
  return workerLog === null ? null : { ...report, workerLog };
}

/**
 * `report` as the API takes it, with its gzipped body: cut while its inflated JSON breaks the part's
 * shape or its body passes the part's cap; null when even the smallest cut does not fit.
 */
export async function fittedReport(
  report: FullReport,
): Promise<{ readonly report: FullReport; readonly body: GzipBytes } | null> {
  if (!canGzip()) return null;
  let candidate = report;
  for (let pass = 0; pass < SHRINK_PASSES; pass++) {
    const text = JSON.stringify(candidate);
    if (shapeFits(jsonShape(text), 'report')) {
      const body = await gzipText(text);
      if (body.byteLength <= REPORT_UPLOAD_LIMITS.report.bytes) return { report: candidate, body };
    }
    const next = shrunk(candidate);
    if (next === null) return null;
    candidate = next;
  }
  return null;
}
