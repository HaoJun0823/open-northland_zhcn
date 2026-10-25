import {
  framesIn,
  GOVERN_RELEASE_MS,
  LAG_BEHIND_MS,
  SLOW_AT_ONCE_MS,
  SLOW_GRACE_MS,
  SLOW_WAIT_AFTER_MS,
} from './governor.js';

/**
 * Which members the clock is paced for, and which of them it waits for, judged by each member's
 * backlog: the ticks it trails beyond what its link and the room's reserve hold in flight. A member
 * with a backlog of more than `LAG_BEHIND_MS` of frames is lagging and catches up alone; one lagging
 * for `SLOW_GRACE_MS` on end, or with a backlog of more than `SLOW_AT_ONCE_MS`, is slow, and stays slow
 * until its backlog is no more than `GOVERN_RELEASE_MS`. One slow for `SLOW_WAIT_AFTER_MS` on end is
 * waited for. A hold on a member for another reason keeps its verdict and pauses both of its clocks:
 * wall time under such a hold does not count as lagging or as slow.
 */
export class Pacing {
  /** When each lagging member began to lag, in the relay's milliseconds. */
  private readonly laggingSince = new Map<string, number>();
  /** When each slow member became slow. */
  private readonly slowSince = new Map<string, number>();
  /** When the hold on each held member began, while it lasts. */
  private readonly heldSince = new Map<string, number>();
  /** A proven slow member may catch up while its machine still cannot sustain the requested speed. */
  private readonly capacityLimited = new Set<string>();

  readonly isSlow = (token: string): boolean => this.slowSince.has(token);

  governs(token: string): boolean {
    return this.isSlow(token) || this.capacityLimited.has(token);
  }

  /** The member has been slow long enough that the room waits for it until it is released. */
  waitsFor(token: string, now: number): boolean {
    const since = this.slowSince.get(token);
    return since !== undefined && !this.heldSince.has(token) && now - since >= SLOW_WAIT_AFTER_MS;
  }

  /** The member's lag says nothing at `now`, as when the clock waits for it: its clocks stop until the
   *  next `observe`. */
  hold(token: string, now: number): void {
    if (!this.heldSince.has(token)) this.heldSince.set(token, now);
  }

  /** Judge a member the relay follows from its backlog in ticks at `requestedSpeed`. */
  observe(
    token: string,
    backlogTicks: number,
    requestedSpeed: number,
    now: number,
    loadSpeedLimit = Number.POSITIVE_INFINITY,
  ): void {
    this.resume(token, now);
    if (loadSpeedLimit >= requestedSpeed) this.capacityLimited.delete(token);
    if (this.slowSince.has(token)) {
      if (loadSpeedLimit < requestedSpeed) this.capacityLimited.add(token);
      if (backlogTicks <= framesIn(GOVERN_RELEASE_MS, requestedSpeed)) {
        this.slowSince.delete(token);
        this.laggingSince.delete(token);
      }
      return;
    }
    if (backlogTicks <= framesIn(LAG_BEHIND_MS, requestedSpeed)) {
      this.laggingSince.delete(token);
      return;
    }
    const since = this.laggingSince.get(token) ?? now;
    this.laggingSince.set(token, since);
    if (now - since >= SLOW_GRACE_MS || backlogTicks > framesIn(SLOW_AT_ONCE_MS, requestedSpeed)) {
      this.slowSince.set(token, now);
      if (loadSpeedLimit < requestedSpeed) this.capacityLimited.add(token);
    }
  }

  /** A member that left, or whose world is being replaced, starts with no lag on record. */
  forget(token: string): void {
    this.laggingSince.delete(token);
    this.slowSince.delete(token);
    this.heldSince.delete(token);
    this.capacityLimited.delete(token);
  }

  /** Move the member's clocks past the hold that just ended. */
  private resume(token: string, now: number): void {
    const heldAt = this.heldSince.get(token);
    if (heldAt === undefined) return;
    this.heldSince.delete(token);
    const heldMs = now - heldAt;
    for (const clock of [this.laggingSince, this.slowSince]) {
      const since = clock.get(token);
      if (since !== undefined) clock.set(token, since + heldMs);
    }
  }
}
