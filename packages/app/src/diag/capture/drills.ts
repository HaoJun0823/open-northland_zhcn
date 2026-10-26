import { debugFlags } from '../debug-flags.js';
import { BOOT_GRACE_MS, FREEZE_REPORT_MS, WATCHDOG_BEAT_MS } from './watchdog/freeze-watch.js';

/** `?debug=` flags that break a running game on purpose, so the bug report flow can be tried end to
 *  end. Development servers only: a release build ignores them. */
export const CRASH_DRILL_FLAG = 'crash';
export const WORKER_CRASH_DRILL_FLAG = 'crash-worker';
export const FREEZE_DRILL_FLAG = 'freeze';

/** Past the boot's grace, which the page samples once a beat, so the drill's freeze is no boot's. */
const DRILL_DELAY_MS = BOOT_GRACE_MS + 2 * WATCHDOG_BEAT_MS;
/** Past the watchdog's threshold, so the freeze is reported and not only logged. */
const FREEZE_DRILL_MS = FREEZE_REPORT_MS + 4000;

/** Run the drills `params` names once the game has run a moment; the game ending first cancels them. */
export function scheduleFaultDrills(
  params: URLSearchParams,
  crashWorker: () => void,
  lifetime: AbortSignal,
): void {
  const flags = debugFlags(params);
  const freeze = flags.has(FREEZE_DRILL_FLAG);
  const crash = flags.has(CRASH_DRILL_FLAG);
  const workerCrash = flags.has(WORKER_CRASH_DRILL_FLAG);
  if (!freeze && !crash && !workerCrash) return;
  const timer = setTimeout(() => {
    if (freeze) {
      const until = performance.now() + FREEZE_DRILL_MS;
      while (performance.now() < until) {
        // The drill is the busy wait.
      }
    }
    if (crash) {
      setTimeout(() => {
        throw new Error('crash drill: the main thread failed on purpose');
      });
    }
    if (workerCrash) crashWorker();
  }, DRILL_DELAY_MS);
  lifetime.addEventListener('abort', () => clearTimeout(timer), { once: true });
}
