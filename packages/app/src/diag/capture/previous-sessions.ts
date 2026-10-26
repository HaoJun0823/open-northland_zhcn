import { REPORT_ID } from '@open-northland/data';
import type { DesktopFault } from '../../view/platform/desktop-faults.js';
import { errorText } from '../error-text.js';
import { diag } from '../log.js';
import { reportProblem } from '../report/problem.js';
import { type CaptureContext, contextRoute } from './context.js';
import { type FaultExtras, pendingDesktopFaults, reportDesktopFaults } from './desktop-faults.js';
import {
  parseContext,
  readLogTail,
  readMarkers,
  removeMarker,
  type SessionMarker,
} from './session-marker.js';
import { judgeMarker, type PreviousPage } from './unclean-exit.js';
import { deleteFreezeRecords, type FreezeRecord, readFreezeRecords } from './watchdog/freeze-records.js';

function contextFacts(context: CaptureContext): Record<string, unknown> {
  return { entry: context.entry, worldId: context.worldId, tick: context.tick };
}

function parseFreezeRecord(value: unknown): FreezeRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, tabId, frozenAt, silentMs, context } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !REPORT_ID.test(id) || typeof tabId !== 'string') return null;
  if (typeof frozenAt !== 'number' || typeof silentMs !== 'number') return null;
  const parsed = parseContext(context);
  return parsed === null ? null : { id, tabId, frozenAt, silentMs, context: parsed };
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

function reportFreeze(record: FreezeRecord, marker: SessionMarker | null): void {
  const log = marker === null ? null : readLogTail(marker.id);
  reportProblem({
    trigger: 'main-freeze',
    // Frozen for at least this long; the page never beat again, so the whole length is unknown.
    facts: { freezeMs: record.silentMs, ended: 'closed', ...contextFacts(record.context) },
    earlier: {
      id: record.id,
      at: new Date(record.frozenAt).toISOString(),
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
      ...(log === null ? {} : { log }),
      route: contextRoute(marker.context),
    },
  });
}

/**
 * Report what earlier pages left: the shell's faults, freezes that never ended and pages that ended
 * without closing, each once, then forget them. Markers of tabs still running stay; `ownId` is this
 * page's.
 */
export async function reportPreviousSessions(ownId: string, previous: PreviousPage | null): Promise<void> {
  const faults = window.desktop?.faults;
  const pending: readonly DesktopFault[] = faults === undefined ? [] : await pendingDesktopFaults(faults);
  const records = await freezeRecords();
  const markers = readMarkers(ownId);
  const nowMs = Date.now();
  const desktopFaults = pending.map((fault) => ({ id: fault.id, atMs: Date.parse(fault.at) }));
  /** Each marker the shell's faults matched: those faults, reported as one with the marker's log. */
  const groups: { readonly ids: readonly string[]; readonly extras: FaultExtras }[] = [];
  const liveTabs = new Set<string>();
  const reported: string[] = [];
  for (const marker of markers) {
    const freeze = records.find((record) => record.tabId === marker.id) ?? null;
    const verdict = judgeMarker(marker, { nowMs, previous, desktopFaults, freezeId: freeze?.id ?? null });
    if (verdict.kind === 'live') {
      liveTabs.add(marker.id);
      continue;
    }
    if (verdict.kind === 'desktop') {
      const log = readLogTail(marker.id);
      groups.push({
        ids: verdict.faultIds,
        extras: {
          ...(log === null ? {} : { log }),
          route: contextRoute(marker.context),
          facts: {
            ...contextFacts(marker.context),
            ...(freeze === null ? {} : { freezeMs: freeze.silentMs }),
          },
        },
      });
    } else if (verdict.kind === 'freeze' && freeze !== null) reportFreeze(freeze, marker);
    else if (verdict.kind === 'unclean-exit') reportUncleanExit(marker);
    if (freeze !== null) reported.push(freeze.id);
    removeMarker(marker.id);
  }
  // A record whose page left no marker still names a freeze nobody saw end.
  for (const record of records) {
    if (record.tabId === ownId || liveTabs.has(record.tabId) || reported.includes(record.id)) continue;
    reportFreeze(record, null);
    reported.push(record.id);
  }
  if (reported.length > 0) {
    await deleteFreezeRecords(reported).catch((error: unknown) =>
      diag.warn('freeze', `reported freeze records stayed: ${errorText(error)}`),
    );
  }
  if (faults === undefined) return;
  const grouped = new Set<string>();
  for (const { ids, extras } of groups) {
    const group = pending.filter((fault) => ids.includes(fault.id) && !grouped.has(fault.id));
    for (const fault of group) grouped.add(fault.id);
    await reportDesktopFaults(faults, group, extras);
  }
  for (const fault of pending) if (!grouped.has(fault.id)) await reportDesktopFaults(faults, [fault]);
}
