import { REPORT_LIMITS, type ReportLog } from '@open-northland/data';
import { jsonSafeData } from '../bundle.js';
import type { DiagEntry, DiagLevel } from '../log.js';
import { LOG_DATA_MAX_CHARS } from './budget.js';
import { gzipSize } from './gzip.js';
import { scrubJson, scrubText } from './redact.js';

/** The oldest entries a cut keeps: the boot header and what the page did first. */
const HEAD_SHARE = 0.2;
/** A cut aims this far under its budget, since entries differ in size. */
const FIT_MARGIN = 0.9;
/** A budget is approached by rescaling; each pass gzips the candidate once. */
const FIT_PASSES = 4;
const CHANNEL_CHARS = 64;
const LEVELS: readonly DiagLevel[] = ['debug', 'info', 'warn', 'error'];
const ELLIPSIS = '…';

type ReportEntry = ReportLog['entries'][number];

function clipped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

/** One entry as the report schema takes it: bounded strings, JSON data, no home paths or secrets. */
export function reportEntry(entry: DiagEntry, secrets: readonly string[]): ReportEntry {
  const level = LEVELS.includes(entry.level) ? entry.level : 'info';
  const out: { -readonly [K in keyof ReportEntry]: ReportEntry[K] } = {
    timeMs: Number.isFinite(entry.timeMs) ? entry.timeMs : 0,
    channel: clipped(String(entry.channel), CHANNEL_CHARS),
    level,
    message: clipped(scrubText(String(entry.message), secrets), REPORT_LIMITS.message),
  };
  if (entry.data !== undefined) {
    const data = scrubJson(jsonSafeData(entry.data), secrets);
    if (data !== undefined) {
      const text = JSON.stringify(data);
      out.data =
        text.length <= LOG_DATA_MAX_CHARS ? (data as ReportEntry['data']) : clipped(text, LOG_DATA_MAX_CHARS);
    }
  }
  return out;
}

/** The first `count` entries split between the oldest and the newest. */
export function headAndTail<T>(entries: readonly T[], count: number): { kept: T[]; dropped: number } {
  if (entries.length <= count) return { kept: [...entries], dropped: 0 };
  const head = Math.floor(count * HEAD_SHARE);
  const tail = count - head;
  return {
    kept: [...entries.slice(0, head), ...entries.slice(entries.length - tail)],
    dropped: entries.length - count,
  };
}

/**
 * The ring cut to at most `maxEntries` and, gzipped, about `budgetBytes`: whole entries from both
 * ends, `dropped` counting the ones between.
 */
export async function cutLog(
  entries: readonly DiagEntry[],
  maxEntries: number,
  budgetBytes: number,
  secrets: readonly string[],
): Promise<ReportLog> {
  const limit = Math.min(maxEntries, REPORT_LIMITS.logEntries);
  const cleaned = entries.map((entry) => reportEntry(entry, secrets));
  let count = Math.min(cleaned.length, limit);
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    const { kept, dropped } = headAndTail(cleaned, count);
    const size = await gzipSize(kept);
    if (size <= budgetBytes || count <= 1) return { entries: kept, dropped };
    count = Math.max(1, Math.floor((count * budgetBytes * FIT_MARGIN) / size));
  }
  const { kept, dropped } = headAndTail(cleaned, count);
  return { entries: kept, dropped };
}

/** A log another page already cut, held to this report's limits again. */
export function recutLog(log: ReportLog, maxEntries: number, secrets: readonly string[]): ReportLog {
  const { kept, dropped } = headAndTail(log.entries, Math.min(maxEntries, REPORT_LIMITS.logEntries));
  return {
    entries: kept.map((entry) => reportEntry(entry, secrets)),
    dropped: log.dropped + dropped,
  };
}
