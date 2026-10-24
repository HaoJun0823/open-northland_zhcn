import { TICK_MS, TICKS_PER_SECOND } from '@open-northland/net-protocol';

export const INITIAL_INPUT_DELAY_TICKS = 2;
const PING_INTERVAL_MS = 1000;
/** A ping unanswered this long is superseded by the next; round trips up to here are measured. */
const PING_TIMEOUT_MS = 5000;
const MIN_INPUT_DELAY_TICKS = 1;
/**
 * One second of ticks. A higher delay would only add latency: an order the relay receives after its
 * stamped tick has passed lands on the next unemitted tick instead, so a link slower than the cap
 * still applies every order, only with its own jitter in the timing.
 */
export const MAX_INPUT_DELAY_TICKS = TICKS_PER_SECOND;
/** Ticks one sample may raise the delay by, so an outlier that slips past the clamp costs one tick. */
const MAX_RAISE_TICKS_PER_SAMPLE = 1;
/** Samples in a row whose smoothed budget is below the delay before the delay drops to that budget. */
const LOWER_AFTER_SAMPLES = 3;
/** Weight of the newest sample in the smoothed round trip and jitter. */
const SMOOTHING = 0.25;
/** A sample counts as at most this multiple of the smoothed trip, so one late pong moves it little. */
const MAX_SAMPLE_TRIP_FACTOR = 2;
/** The least headroom above the smoothed trip a sample keeps, so a near-zero trip can still grow. */
const MIN_SAMPLE_HEADROOM_MS = TICK_MS;
/** The first sample has no smoothed trip to clamp against; it counts as at most the cap's budget. */
const MAX_FIRST_SAMPLE_MS = MAX_INPUT_DELAY_TICKS * TICK_MS;

/**
 * Ticks between a member issuing a command and its application, budgeted from that member's smoothed
 * round trip and jitter as `ceil((rtt + jitter) / tick) + 1`, capped at `MAX_INPUT_DELAY_TICKS`. Each
 * sample is clamped before it enters the smoothing, the delay rises at most a tick per sample and
 * drops to the budget once that has stayed lower for a few samples, so a single late pong neither
 * sets seconds of delay nor keeps it for minutes.
 */
export class InputDelayEstimator {
  private smoothedRtt: number | null = null;
  private jitter = 0;
  private lowerStreak = 0;
  private delay = INITIAL_INPUT_DELAY_TICKS;
  private sampleCount = 0;

  get samples(): number {
    return this.sampleCount;
  }

  get ticks(): number {
    return this.delay;
  }

  get roundTripMs(): number {
    return this.smoothedRtt ?? 0;
  }

  get jitterMs(): number {
    return this.jitter;
  }

  /** Feed one measured round trip; true when the assigned delay changed. */
  sample(rttMs: number): boolean {
    this.sampleCount++;
    const before = this.delay;
    if (this.smoothedRtt === null) {
      this.smoothedRtt = Math.min(rttMs, MAX_FIRST_SAMPLE_MS);
      this.delay = delayFor(this.smoothedRtt, this.jitter);
      return this.delay !== before;
    }
    const counted = Math.min(
      rttMs,
      Math.max(this.smoothedRtt * MAX_SAMPLE_TRIP_FACTOR, this.smoothedRtt + MIN_SAMPLE_HEADROOM_MS),
    );
    this.jitter += SMOOTHING * (Math.abs(counted - this.smoothedRtt) - this.jitter);
    this.smoothedRtt += SMOOTHING * (counted - this.smoothedRtt);
    const budget = delayFor(this.smoothedRtt, this.jitter);
    if (budget > this.delay) {
      this.delay = Math.min(budget, this.delay + MAX_RAISE_TICKS_PER_SAMPLE);
      this.lowerStreak = 0;
    } else if (budget < this.delay) {
      this.lowerStreak++;
      if (this.lowerStreak >= LOWER_AFTER_SAMPLES) {
        this.delay = budget;
        this.lowerStreak = 0;
      }
    } else {
      this.lowerStreak = 0;
    }
    return this.delay !== before;
  }
}

function delayFor(rttMs: number, jitterMs: number): number {
  const ticks = Math.ceil((rttMs + jitterMs) / TICK_MS) + 1;
  return Math.min(MAX_INPUT_DELAY_TICKS, Math.max(MIN_INPUT_DELAY_TICKS, ticks));
}

/** One client's round-trip probe: pings on a cadence, answers by the exact stamp only, delay from the
 *  estimator. */
export class LatencyProbe {
  readonly delay = new InputDelayEstimator();
  private pingSentAt: number | null = null;
  /** The outstanding ping's answer waits behind a message from the client that was still arriving. */
  private pingHeld = false;
  /** A large message to the client is still queued ahead of anything sent to it now. */
  private downloadInFlight = false;
  private lastPingAt: number;

  constructor(now: number) {
    this.lastPingAt = now;
  }

  /** The stamp to ping with, when one is due. */
  pingDue(now: number): number | null {
    if (now - this.lastPingAt < PING_INTERVAL_MS) return null;
    if (this.pingSentAt !== null && now - this.pingSentAt < PING_TIMEOUT_MS) return null;
    this.lastPingAt = now;
    this.pingSentAt = now;
    this.pingHeld = this.downloadInFlight;
    return now;
  }

  /** A ping sent while a large message to the client is in flight waits behind it, and its answer
   *  measures that download, not the link, so it is not sampled. A ping already ahead of it is. */
  downloading(inFlight: boolean): void {
    this.downloadInFlight = inFlight;
  }

  /** A message from the client is still arriving: the answer to a ping already sent queues behind it
   *  and measures that upload, not the link, so it is not sampled. */
  held(): void {
    if (this.pingSentAt !== null) this.pingHeld = true;
  }

  /** Take a pong; true when the assigned delay changed. A stamp that is not the outstanding ping is
   *  ignored, so a client cannot shorten its own budget. */
  pong(stamp: number, now: number): boolean {
    if (this.pingSentAt === null || stamp !== this.pingSentAt) return false;
    this.pingSentAt = null;
    if (this.pingHeld) return false;
    return this.delay.sample(now - stamp);
  }
}
