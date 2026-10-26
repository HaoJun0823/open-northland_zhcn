/** WebGL context loss on the game canvas, for the log ring: the browser and Pixi restore the context by
 *  themselves, so without this a diagnostics report says nothing of a lost and rebuilt frame. A loss
 *  not restored in {@link CONTEXT_RESTORE_GRACE_MS} is a bug report: the world no longer draws. */
import { type DiagLog, diag } from './log.js';
import { type ProblemSink, reportProblem } from './report/problem.js';

/** Chromium restores a lost context within a second or two once the GPU process is back. */
export const CONTEXT_RESTORE_GRACE_MS = 5000;

/** Listens until `signal` aborts; `tick` dates each entry in sim ticks. */
export function logGpuContextLoss(
  canvas: EventTarget,
  tick: () => number,
  signal: AbortSignal,
  target: DiagLog = diag,
  report: ProblemSink = reportProblem,
): void {
  let waiting: ReturnType<typeof setTimeout> | null = null;
  const stopWaiting = (): void => {
    if (waiting !== null) clearTimeout(waiting);
    waiting = null;
  };
  // A hidden page may get its context back only once it shows, so the wait runs on while hidden.
  const awaitRestore = (lostMs: number): void => {
    waiting = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        awaitRestore(lostMs);
        return;
      }
      waiting = null;
      const waitedMs = Math.round(performance.now() - lostMs);
      target.error('gpu', `webgl context not restored after ${waitedMs} ms`, { tick: tick() });
      report({ trigger: 'context-lost', facts: { tick: tick(), waitedMs } });
    }, CONTEXT_RESTORE_GRACE_MS);
  };
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      target.warn('gpu', 'webgl context lost', { tick: tick() });
      stopWaiting();
      awaitRestore(performance.now());
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      stopWaiting();
      target.info('gpu', 'webgl context restored', { tick: tick() });
    },
    { signal },
  );
  signal.addEventListener('abort', stopWaiting, { once: true });
}
