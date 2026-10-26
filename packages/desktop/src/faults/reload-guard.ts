/** A page that dies again this soon after the previous death is not reloaded without asking. */
const QUICK_RECRASH_MS = 60_000;

export interface CrashReloadGuard {
  /** Notes a renderer death at `nowMs`; true when the shell may reload the page without asking. */
  reloadWithoutAsking(nowMs: number): boolean;
}

/**
 * A page that crashes while it boots would otherwise reload forever. The first death reloads at once;
 * one within `QUICK_RECRASH_MS` of the previous asks the player whether to restart or quit.
 */
export function createCrashReloadGuard(windowMs = QUICK_RECRASH_MS): CrashReloadGuard {
  let previousMs: number | undefined;
  return {
    reloadWithoutAsking(nowMs) {
      const quiet = previousMs === undefined || nowMs - previousMs >= windowMs;
      previousMs = nowMs;
      return quiet;
    },
  };
}
