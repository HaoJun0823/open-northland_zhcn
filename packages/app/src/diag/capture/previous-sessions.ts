import { REPORT_ID } from '@open-northland/data';
import type { DesktopFault } from '../../view/platform/desktop-faults.js';
import { errorText } from '../error-text.js';
import { diag } from '../log.js';
import { reportProblem } from '../report/problem.js';
import { type CaptureContext, contextRoute } from './context.js';
import {
  clearDesktopFaults,
  type FaultExtras,
  pendingDesktopFaults,
  reportDesktopFaults,
} from './desktop-faults.js';
import {
  parseContext,
  readLogTail,
  readMarkers,
  removeMarker,
  type SessionMarker,
} from './session-marker.js';
import { judgeMarker, MARKER_STALE_MS, type PreviousPage } from './unclean-exit.js';
import { deleteFreezeRecords, type FreezeRecord, readFreezeRecords } from './watchdog/freeze-records.js';
import { freezeWorthReport } from './watchdog/freeze-watch.js';

function contextFacts(context: CaptureContext): Record<string, unknown> {
  return { entry: context.entry, worldId: context.worldId, tick: context.tick };
}

function parseFreezeRecord(value: unknown): FreezeRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, tabId, frozenAt, seenAt, context } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !REPORT_ID.test(id) || typeof tabId !== 'string') return null;
  if (typeof frozenAt !== 'number' || typeof seenAt !== 'number') return null;
  const parsed = parseContext(context);
  return parsed === null ? null : { id, tabId, frozenAt, seenAt, context: parsed };
}

async function freezeRecords(): Promise<FreezeRecord[]> {
  try {
    const records = await readFreezeRecords();
    const parsed = records.map(parseFreezeRecord);
    const unreadable = records.length - parsed.filter((record) => record !== null).length;
    if (unreadable > 0) diag.warn('freeze', `${unreadable} unreadable freeze records left behind`);
    return parsed.filter((record) => record !== null);
  } catch (error) {
    diag.warn('freeze', `the freeze records could not be read: ${errorText(error)}`);
    return [];
  }
}

/** Frozen for at least this long: the watchdog rewrote the record until the page was gone. */
function lastedMs(record: FreezeRecord): number {
  return record.seenAt - record.frozenAt;
}

/** A boot the player gave up on before it got anywhere near stuck is forgotten unreported. */
function worthReport(record: FreezeRecord): boolean {
  return freezeWorthReport(lastedMs(record), record.context.booting);
}

function reportFreeze(record: FreezeRecord, marker: SessionMarker | null): void {
  const log = marker === null ? null : readLogTail(marker.id);
  reportProblem({
    trigger: 'main-freeze',
    facts: { freezeMs: lastedMs(record), ended: 'closed', ...contextFacts(record.context) },
    earlier: {
      id: record.id,
      at: new Date(record.frozenAt).toISOString(),
      previousSession: true,
      ...(log === null ? {} : { log }),
      route: contextRoute(record.context),
    },
  });
}

function reportUncleanExit(marker: SessionMarker): void {
  const log = readLogTail(marker.id);
  reportProblem({
    trigger: 'unclean-exit',
    facts: { sessionMs: marker.beatAt - marker.startedAt, ...contextFacts(marker.context) },
    earlier: {
      id: marker.id,
      at: new Date(marker.beatAt).toISOString(),
      previousSession: true,
      ...(log === null ? {} : { log }),
      route: contextRoute(marker.context),
    },
  });
}

/** The page running this sweep. */
export interface OwnPage {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
}

/**
 * Report what earlier pages left: the shell's faults, freezes that never ended and pages that ended
 * without closing, each once, then forget them. Markers of tabs still running stay, and so does the
 * shell's record of this page's own hang, which this page reports when it thaws.
 */
export async function reportPreviousSessions(own: OwnPage, previous: PreviousPage | null): Promise<void> {
  const faults = window.desktop?.faults;
  const pending = (faults === undefined ? [] : await pendingDesktopFaults(faults)).filter(
    (fault) => fault.trigger !== 'renderer-unresponsive' || Date.parse(fault.at) < own.startedAt,
  );
  const records = await freezeRecords();
  const markers = readMarkers(own.id);
  const nowMs = Date.now();
  const desktopFaults = pending.map((fault) => ({ id: fault.id, atMs: Date.parse(fault.at) }));
  /** Each marker the shell's faults matched: those faults, reported as one with the marker's log. */
  const groups: { readonly ids: readonly string[]; readonly extras: FaultExtras }[] = [];
  /** The shell's hangs of freezes not worth a report, forgotten with them. */
  const dismissed: DesktopFault[] = [];
  const liveTabs = new Set<string>();
  const finished: string[] = [];
  // A tab whose watchdog still rewrites its freeze record is frozen right now, not gone: it reports
  // the freeze itself when it thaws.
  for (const record of records) if (nowMs - record.seenAt <= MARKER_STALE_MS) liveTabs.add(record.tabId);
  for (const marker of markers) {
    const freeze = records.find((record) => record.tabId === marker.id) ?? null;
    const facts = { nowMs, previous, desktopFaults, freezeId: freeze?.id ?? null };
    const judged = liveTabs.has(marker.id) ? ({ kind: 'live' } as const) : judgeMarker(marker, facts);
    if (judged.kind === 'live') {
      liveTabs.add(marker.id);
      continue;
    }
    const quietFreeze = freeze !== null && !worthReport(freeze);
    // A short boot freeze says nothing of how the page ended: it ends as it would without the record.
    const verdict =
      judged.kind === 'freeze' && quietFreeze ? judgeMarker(marker, { ...facts, freezeId: null }) : judged;
    if (verdict.kind === 'desktop') {
      const matched = pending.filter((fault) => verdict.faultIds.includes(fault.id));
      const hangs = quietFreeze ? matched.filter((fault) => fault.trigger === 'renderer-unresponsive') : [];
      dismissed.push(...hangs);
      const log = readLogTail(marker.id);
      groups.push({
        ids: matched.filter((fault) => !hangs.includes(fault)).map((fault) => fault.id),
        extras: {
          previousSession: true,
          ...(log === null ? {} : { log }),
          route: contextRoute(marker.context),
          facts: {
            ...contextFacts(marker.context),
            ...(freeze === null ? {} : { freezeMs: lastedMs(freeze) }),
          },
        },
      });
    } else if (verdict.kind === 'freeze' && freeze !== null) reportFreeze(freeze, marker);
    else if (verdict.kind === 'unclean-exit') reportUncleanExit(marker);
    if (freeze !== null) finished.push(freeze.id);
    removeMarker(marker.id);
  }
  // A record whose page left no marker still names a freeze nobody saw end.
  for (const record of records) {
    if (record.tabId === own.id || liveTabs.has(record.tabId) || finished.includes(record.id)) continue;
    if (worthReport(record)) reportFreeze(record, null);
    finished.push(record.id);
  }
  if (finished.length > 0) {
    await deleteFreezeRecords(finished).catch((error: unknown) =>
      diag.warn('freeze', `finished freeze records stayed: ${errorText(error)}`),
    );
  }
  if (faults === undefined) return;
  await clearDesktopFaults(faults, dismissed);
  const grouped = new Set<string>(dismissed.map((fault) => fault.id));
  for (const { ids, extras } of groups) {
    const group = pending.filter((fault) => ids.includes(fault.id) && !grouped.has(fault.id));
    for (const fault of group) grouped.add(fault.id);
    await reportDesktopFaults(faults, group, extras);
  }
  // The later sweep also finds what the shell recorded of this page, such as a GPU restart.
  for (const fault of pending) {
    if (grouped.has(fault.id)) continue;
    await reportDesktopFaults(faults, [fault], { previousSession: Date.parse(fault.at) < own.startedAt });
  }
}
