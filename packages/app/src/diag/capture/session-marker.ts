import { REPORT_ID, REPORT_LIMITS, ReportLog } from '@open-northland/data';
import type { DiagEntry, DiagLog } from '../log.js';
import type { CaptureContext } from './context.js';

/**
 * A page's session marker in localStorage: one per page, so tabs never share one, written on a slow
 * heartbeat and removed on `pagehide`. A marker left behind is a page that ended without closing.
 * localStorage, not IndexedDB, because `pagehide` must remove it synchronously.
 */
export interface SessionMarker {
  /** 128 random bits as hex; a report of this page's end takes it as its id. */
  readonly id: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly beatAt: number;
  /** The page was visible at its last write. */
  readonly visible: boolean;
  readonly context: CaptureContext;
}

const MARKER_PREFIX = 'open-northland.session.';
const LOG_PREFIX = 'open-northland.session-log.';

/** The entries of the log's tail a marker keeps: enough to show what led up to the end. */
export const MARKER_LOG_ENTRIES = 200;
/** A tail entry's message is cut to this, and its data dropped when it serializes longer, so the
 *  tail stays a few tens of kilobytes. */
const TAIL_MESSAGE_CHARS = 500;
const TAIL_DATA_CHARS = 1000;

/** Storage may be denied (a private window, a sandboxed frame) or full; a marker is best effort. */
function attempt(write: () => void): void {
  try {
    write();
  } catch {
    // Best effort: a page without a marker is only never reported as ended uncleanly.
  }
}

export function writeMarker(marker: SessionMarker): void {
  attempt(() => localStorage.setItem(MARKER_PREFIX + marker.id, JSON.stringify(marker)));
}

/** The page's marker is in storage; false where storage cannot be read. */
export function markerKept(id: string): boolean {
  try {
    return localStorage.getItem(MARKER_PREFIX + id) !== null;
  } catch {
    return false;
  }
}

export function removeMarker(id: string): void {
  attempt(() => {
    localStorage.removeItem(MARKER_PREFIX + id);
    localStorage.removeItem(LOG_PREFIX + id);
  });
}

function tailEntry(entry: DiagEntry): DiagEntry {
  const message =
    entry.message.length > TAIL_MESSAGE_CHARS ? entry.message.slice(0, TAIL_MESSAGE_CHARS) : entry.message;
  const { data: _data, ...bare } = entry;
  if (entry.data === undefined) return message === entry.message ? entry : { ...bare, message };
  let data: string | undefined;
  try {
    data = JSON.stringify(entry.data);
  } catch {
    data = undefined;
  }
  return data !== undefined && data.length <= TAIL_DATA_CHARS ? { ...entry, message } : { ...bare, message };
}

/** Keep the log's newest entries beside the marker, for a report of this page's end. */
export function writeLogTail(id: string, log: DiagLog): void {
  const entries = log.tail(MARKER_LOG_ENTRIES).map(tailEntry);
  const tail = { entries, dropped: log.written - entries.length };
  attempt(() => localStorage.setItem(LOG_PREFIX + id, JSON.stringify(tail)));
}

/** The log's newest entries as a report's log; null when they do not fit its schema. */
export function reportLogOf(log: DiagLog, count: number): ReportLog | null {
  const entries = log
    .tail(count)
    .map((entry) =>
      entry.message.length > REPORT_LIMITS.message
        ? { ...entry, message: entry.message.slice(0, REPORT_LIMITS.message) }
        : entry,
    );
  return parseReportLog(JSON.stringify({ entries, dropped: log.written - entries.length }));
}

function parseReportLog(text: string): ReportLog | null {
  try {
    const parsed = ReportLog.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readLogTail(id: string): ReportLog | null {
  try {
    const text = localStorage.getItem(LOG_PREFIX + id);
    return text === null ? null : parseReportLog(text);
  } catch {
    return null;
  }
}

/** Every page's marker but `exceptId`'s; one this build cannot read is removed. */
export function readMarkers(exceptId: string): SessionMarker[] {
  const markers: SessionMarker[] = [];
  const unreadable: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(MARKER_PREFIX)) continue;
      const id = key.slice(MARKER_PREFIX.length);
      if (id === exceptId) continue;
      const marker = parseMarker(localStorage.getItem(key));
      if (marker !== null && marker.id === id) markers.push(marker);
      else unreadable.push(id);
    }
  } catch {
    return markers;
  }
  for (const id of unreadable) removeMarker(id);
  return markers;
}

function parseMarker(text: string | null): SessionMarker | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { id, startedAt, beatAt, visible, context } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !REPORT_ID.test(id)) return null;
  if (typeof startedAt !== 'number' || typeof beatAt !== 'number' || typeof visible !== 'boolean')
    return null;
  const parsedContext = parseContext(context);
  return parsedContext === null ? null : { id, startedAt, beatAt, visible, context: parsedContext };
}

/** A context as a marker or a freeze record kept it, or null for another shape. */
export function parseContext(value: unknown): CaptureContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const { entry, search, worldId, tick, inGame, booting } = value as Record<string, unknown>;
  if (typeof entry !== 'string' || entry.length > REPORT_LIMITS.text) return null;
  if (typeof search !== 'string' || typeof inGame !== 'boolean' || typeof booting !== 'boolean') return null;
  if (worldId !== null && typeof worldId !== 'string') return null;
  if (tick !== null && typeof tick !== 'number') return null;
  return { entry, search, worldId, tick, inGame, booting };
}
