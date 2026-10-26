import { errorText } from '../error-text.js';
import { diag } from '../log.js';
import { takeBootFaults } from './boot-faults.js';
import { captureContext } from './context.js';
import { reportPreviousSessions } from './previous-sessions.js';
import { randomReportId } from './report-id.js';
import { markerKept, removeMarker, writeLogTail, writeMarker } from './session-marker.js';
import { MARKER_BEAT_MS, MARKER_STALE_MS, type PreviousPage } from './unclean-exit.js';
import { WATCHDOG_BEAT_MS } from './watchdog/freeze-watch.js';
import { openWatchdog } from './watchdog/watchdog.js';

/** sessionStorage outlives a reload in the same tab, so the next page there knows this one's marker. */
const TAB_SESSION_KEY = 'open-northland.tab-session';

/** A beat this much later than due means the main thread was blocked: a warning in the log, cheap
 *  enough to keep for every page. A freeze long enough to report is the watchdog's. */
export const LONG_BLOCK_WARN_MS = 2000;

const BEATS_PER_MARKER = MARKER_BEAT_MS / WATCHDOG_BEAT_MS;

function storedTabSession(): string | null {
  try {
    return sessionStorage.getItem(TAB_SESSION_KEY);
  } catch {
    return null;
  }
}

function storeTabSession(id: string): void {
  try {
    sessionStorage.setItem(TAB_SESSION_KEY, id);
  } catch {
    // Without it a reload is told from another tab by its marker's age alone.
  }
}

/** The page this one replaced in the same tab: a reload, or the reload of a discarded tab. A tab
 *  duplicated from this one copies its sessionStorage too, but is no reload. */
function previousPage(): PreviousPage | null {
  const id = storedTabSession();
  if (id === null) return null;
  const discarded = (document as { wasDiscarded?: boolean }).wasDiscarded === true;
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return discarded || navigation?.type === 'reload' ? { id, discarded } : null;
}

let installed = false;
let watchdog: ReturnType<typeof openWatchdog> = null;

/**
 * A prompt the browser or the desktop shell shows over the page, such as the leave prompt, blocks the
 * main thread while the player reads it, and so does the report's own screenshot render on a slow
 * GPU: the watchdog stops counting, as for a hidden page, until the page's next beat. Leaving from
 * the prompt then leaves no freeze record behind.
 */
export function pauseFreezeWatch(): void {
  watchdog?.beat(false, captureContext());
}

/**
 * Capture what the window's error listeners cannot see: faults before boot, freezes of the main
 * thread, and pages that ended without closing, with what the desktop shell recorded of them. One
 * timer beats at {@link WATCHDOG_BEAT_MS} for the watchdog and every {@link MARKER_BEAT_MS} for this
 * page's session marker. Call once, after the window's error capture.
 */
export function installFailureCapture(): void {
  if (installed) return;
  installed = true;
  takeBootFaults();
  const id = randomReportId();
  const previous = previousPage();
  storeTabSession(id);
  const startedAt = Date.now();
  watchdog = typeof Worker === 'undefined' ? null : openWatchdog(id);
  let beats = 0;
  let lastBeatMs = performance.now();
  let lastVisible = document.visibilityState === 'visible';
  let markedVisible: boolean | null = null;
  let tailWritten = -1;
  let closed = false;
  const beat = (): void => {
    const nowMs = performance.now();
    const visible = document.visibilityState === 'visible';
    const blockedMs = nowMs - lastBeatMs - WATCHDOG_BEAT_MS;
    if (lastVisible && visible && blockedMs > LONG_BLOCK_WARN_MS) {
      diag.warn('freeze', `the main thread was blocked for about ${Math.round(blockedMs)} ms`);
    }
    lastBeatMs = nowMs;
    lastVisible = visible;
    const context = captureContext();
    watchdog?.beat(visible, context);
    if (closed || (beats++ % BEATS_PER_MARKER !== 0 && visible === markedVisible)) return;
    markedVisible = visible;
    // Another tab's sweep removes a hidden tab's marker with its tail: both come back together.
    const restored = !markerKept(id);
    writeMarker({ id, startedAt, beatAt: Date.now(), visible, context });
    if (restored || diag.written !== tailWritten) {
      tailWritten = diag.written;
      writeLogTail(id, diag);
    }
  };
  beat();
  setInterval(beat, WATCHDOG_BEAT_MS);
  document.addEventListener('visibilitychange', beat);
  // Also on the way into the back-forward cache, from which `pageshow` brings the page back.
  window.addEventListener('pagehide', () => {
    closed = true;
    removeMarker(id);
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    closed = false;
    markedVisible = null;
    beat();
  });
  const sweep = (from: PreviousPage | null): void =>
    void reportPreviousSessions(id, from).catch((error: unknown) =>
      diag.warn('crash', `earlier sessions could not be reported: ${errorText(error)}`),
    );
  sweep(previous);
  // A tab that crashed just before this one opened still looked alive at the first sweep.
  setTimeout(() => sweep(null), MARKER_STALE_MS + MARKER_BEAT_MS);
}
