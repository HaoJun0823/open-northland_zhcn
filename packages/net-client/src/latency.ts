/** Weight of the newest sample in the smoothed click-to-apply time. */
const SMOOTHING = 0.25;

/**
 * Click-to-apply time for this seat's own commands, and how many of them are in flight. The relay
 * keeps one member's commands in order, so the oldest stamp belongs to the next command of this seat
 * to come back in a frame. The outbox bounds the stamps to the relay's per-tick budget.
 */
export class CommandLatency {
  private readonly issuedAt: number[] = [];
  private latestMs: number | null = null;
  private smoothedMs: number | null = null;

  /** The smoothed click-to-apply time in milliseconds; null until a command came back. */
  get clickToApplyMs(): number | null {
    return this.smoothedMs;
  }

  get lastMs(): number | null {
    return this.latestMs;
  }

  /** Commands sent and not yet applied or refused. */
  get inFlight(): number {
    return this.issuedAt.length;
  }

  /** A command went to the relay; `clickedAt` is when the player issued it, before any outbound wait. */
  issued(clickedAt: number): void {
    this.issuedAt.push(clickedAt);
  }

  /** One of this seat's commands applied on a tick that just ran. */
  applied(now: number): void {
    const issued = this.issuedAt.shift();
    if (issued === undefined) return;
    const ms = now - issued;
    this.latestMs = ms;
    this.smoothedMs = this.smoothedMs === null ? ms : this.smoothedMs + SMOOTHING * (ms - this.smoothedMs);
  }

  /** Every client dropped one of this seat's commands from a frame, the oldest in flight. */
  dropped(): void {
    this.issuedAt.shift();
  }

  /** The relay refused a command. It answers on receipt, before any later command of this seat can
   *  have come back, so the refused one is most likely the newest stamp. */
  refused(): void {
    this.issuedAt.pop();
  }

  /** Commands in flight for a replaced world or on a replaced socket may never come back. */
  forgetInFlight(): void {
    this.issuedAt.length = 0;
  }
}
