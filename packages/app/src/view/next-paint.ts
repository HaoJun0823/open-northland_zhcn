/** Cap on a paint yield, so a tab hidden after the frame was requested cannot stall its caller. */
const PAINT_TIMEOUT_MS = 250;

/**
 * Resolve once the browser has painted what was just written, since a long synchronous stretch that
 * follows would otherwise put its label on screen only after finishing. A hidden tab fires no rAF, so
 * it skips the yield.
 */
export function nextPaint(): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = 0;
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(done, PAINT_TIMEOUT_MS);
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}
