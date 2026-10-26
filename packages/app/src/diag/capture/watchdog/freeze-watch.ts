import { StallWatch } from '../../../session/worker/stall-watch.js';
import type { CaptureContext } from '../context.js';

/** How often the page's main thread beats, and the watchdog checks the silence. */
export const WATCHDOG_BEAT_MS = 1000;

/** A visible page silent this long is frozen: far past a long frame or a garbage collection, short
 *  enough that a player waiting on a frozen game has not given up and closed the tab yet. */
export const FREEZE_REPORT_MS = 8000;

/** A boot's long steps (decoding a map, building atlases, compiling shaders) block a slow machine's
 *  page for 8 to 20 s while its card says it is loading. A boot silent three times that long is stuck,
 *  not slow. */
export const BOOT_FREEZE_REPORT_MS = 60_000;

/** The first frames after a boot's card comes down still upload its textures and compile its
 *  shaders, which blocks a slow machine as the boot itself does: a freeze that began this soon after
 *  counts as the boot's. */
export const BOOT_GRACE_MS = 3000;

/** A freeze of `lastedMs` is worth a report; one that began `booting` only when it lasted long. */
export function freezeWorthReport(lastedMs: number, booting: boolean): boolean {
  return lastedMs >= (booting ? BOOT_FREEZE_REPORT_MS : FREEZE_REPORT_MS);
}

export interface FreezeReports {
  /** The page went silent while visible, `silentMs` ago, last beating with `context`. */
  frozen(silentMs: number, context: CaptureContext | null): void;
  /** A frozen page beat again after `freezeMs` of silence. */
  thawed(freezeMs: number, context: CaptureContext | null): void;
}

/**
 * The watchdog's view of the page's heartbeat. Silence counts only while the last beat said the page
 * was visible: a hidden page's timers are throttled to a beat a minute or less. A check that comes
 * late itself means the watchdog was not running either (the machine slept), so that silence is not
 * the page's; {@link StallWatch} holds that rule.
 */
export class FreezeWatch {
  private readonly silence: StallWatch;
  private visible = false;
  private context: CaptureContext | null = null;

  constructor(reports: FreezeReports, thresholdMs: number, beatMs: number, nowMs: number) {
    this.silence = new StallWatch(
      {
        stalled: (silentMs) => reports.frozen(silentMs, this.context),
        recovered: (silentMs) => reports.thawed(silentMs, this.context),
      },
      thresholdMs,
      beatMs,
      nowMs,
    );
  }

  /** A beat; a freeze it ends is told with the context from before it. */
  beat(nowMs: number, visible: boolean, context: CaptureContext): void {
    this.silence.heard(nowMs);
    this.visible = visible;
    this.context = context;
  }

  check(nowMs: number): void {
    if (this.visible) this.silence.check(nowMs);
    else this.silence.heard(nowMs);
  }
}
