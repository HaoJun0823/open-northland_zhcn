import { REPORT_LIMITS } from '@open-northland/data';
import { errorText } from '../../error-text.js';
import { diag } from '../../log.js';
import { reportProblem } from '../../report/problem.js';
import { type CaptureContext, contextRoute } from '../context.js';
import { pendingDesktopFaults, reportDesktopFaults } from '../desktop-faults.js';
import { reportLogOf } from '../session-marker.js';
import type { Thaw, ToWatchdog } from './protocol.js';

/** How long after a thaw the desktop shell has to note its own view of the hang: it records the
 *  hang's length when the page answers again, which is the moment the page thaws. */
const DESKTOP_HANG_SETTLE_MS = 2000;

export interface Watchdog {
  beat(visible: boolean, context: CaptureContext): void;
}

/**
 * The page's freeze watchdog: a worker of its own that the main thread beats, which keeps a record of
 * a freeze while it lasts and says when it ended. Null where no worker can start.
 */
export function openWatchdog(tabId: string): Watchdog | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./watchdog-worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    diag.warn('freeze', `the freeze watchdog did not start: ${errorText(error)}`);
    return null;
  }
  worker.addEventListener('message', (event: MessageEvent<Thaw>) => thawed(event.data));
  worker.addEventListener('error', () => diag.warn('freeze', 'the freeze watchdog failed'));
  const post = (message: ToWatchdog): void => worker.postMessage(message);
  post({ kind: 'start', tabId });
  return { beat: (visible, context) => post({ kind: 'beat', visible, context }) };
}

function thawed(thaw: Thaw): void {
  const { freezeMs, context } = thaw;
  diag.warn('freeze', `the page was frozen for ${Math.round(freezeMs)} ms`, { freezeMs, context });
  const facts = {
    freezeMs: Math.round(freezeMs),
    ...(context === null ? {} : { entry: context.entry, worldId: context.worldId, tick: context.tick }),
  };
  // A boot's long steps (decoding a map, building atlases, compiling shaders) block the page on a slow
  // machine, and its card says it is loading: logged above, no bug. A boot that never ends leaves its
  // freeze record behind, which the next start reports.
  if (context?.booting === true) return;
  const faults = window.desktop?.faults;
  if (faults === undefined) {
    reportProblem({ trigger: 'main-freeze', facts });
    return;
  }
  // The shell records a hang only once it lasted about twice the watchdog's threshold: when it did,
  // its record with the hung call stack is the report, and the page's facts join it.
  setTimeout(() => {
    void pendingDesktopFaults(faults).then((pending) => {
      const nowMs = Date.now();
      const hangs = pending.filter((fault) => {
        const atMs = Date.parse(fault.at);
        return fault.trigger === 'renderer-unresponsive' && atMs >= thaw.frozenAt && atMs <= nowMs;
      });
      if (hangs.length === 0) {
        reportProblem({ trigger: 'main-freeze', facts });
        return;
      }
      // The shell's record reads as an earlier page's, whose log the report takes: this page's is it.
      const log = reportLogOf(diag, REPORT_LIMITS.logEntries);
      return reportDesktopFaults(faults, hangs, {
        facts,
        ...(log === null ? {} : { log }),
        ...(context === null ? {} : { route: contextRoute(context) }),
      });
    });
  }, DESKTOP_HANG_SETTLE_MS);
}
