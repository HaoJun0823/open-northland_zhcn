/** Longest real step one frame may add, so a hitch or a hidden tab resumes the swell where it left off
 *  instead of jumping. */
const MAX_FRAME_STEP_SECONDS = 0.1;

/**
 * The water surface's clock, in seconds. It runs at real time while the game clock moves and stops while
 * it stands, so the sea keeps one pace at every game speed and freezes with a pause. A frame with no real
 * clock (a still capture) reads the game clock instead, so the capture reproduces.
 */
export class WaterClock {
  private seconds = 0;
  private lastGameSeconds: number | undefined;
  private lastRealSeconds: number | undefined;

  advance(gameSeconds: number, realSeconds: number | undefined): number {
    if (realSeconds === undefined) {
      this.lastGameSeconds = undefined;
      this.lastRealSeconds = undefined;
      this.seconds = gameSeconds;
      return this.seconds;
    }
    const lastGame = this.lastGameSeconds;
    const lastReal = this.lastRealSeconds;
    this.lastGameSeconds = gameSeconds;
    this.lastRealSeconds = realSeconds;
    if (lastGame === undefined || lastReal === undefined) return this.seconds;
    if (gameSeconds !== lastGame) {
      this.seconds += Math.min(Math.max(realSeconds - lastReal, 0), MAX_FRAME_STEP_SECONDS);
    }
    return this.seconds;
  }
}
