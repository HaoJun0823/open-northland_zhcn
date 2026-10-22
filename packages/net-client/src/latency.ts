import type { InFlight } from './command-outbox.js';

/** Weight of the newest sample in the smoothed click-to-apply time. */
const SMOOTHING = 0.25;
/** The relay lands a command on its next tick at the earliest. */
const MIN_APPLY_LEAD_TICKS = 1;

/**
 * Click-to-apply time for this seat's own commands, and how many of them are in flight. The relay
 * keeps one member's commands in order, so the oldest stamp belongs to the next command of this seat
 * to come back in a frame. The outbox bounds the stamps to the relay's per-tick budget.
 *
 * Commands sent before a socket or world change are carried: the relay keeps the ones it accepted
 * and applies them first, but some may be lost or already inside a restored world, so none is
 * measured. They stop counting once this client has run past the last tick the relay could have
 * landed them on: its tick at the change plus the input delay. While any is carried nothing new is
 * sent, so every command of this seat applied, dropped or refused meanwhile is a carried one and the
 * count stays exact.
 */
interface Stamp {
  readonly clickedAt: number;
  readonly bytes: number;
}

export class CommandLatency {
  private readonly stamps: Stamp[] = [];
  private stampBytes = 0;
  private carried = 0;
  private carryDelayTicks = 0;
  /** The last tick a carried command can apply on; null until the relay's tick after the change is known. */
  private carriedUntil: number | null = null;
  private latestMs: number | null = null;
  private smoothedMs: number | null = null;

  /** The smoothed click-to-apply time in milliseconds; null until a command came back. */
  get clickToApplyMs(): number | null {
    return this.smoothedMs;
  }

  get lastMs(): number | null {
    return this.latestMs;
  }

  /** Commands sent and not yet applied or refused, carried ones included. */
  get inFlight(): number {
    return this.carried + this.stamps.length;
  }

  /** The measured commands in flight and their bytes; carried ones hold every new send back anyway. */
  get sent(): InFlight {
    return { count: this.stamps.length, bytes: this.stampBytes };
  }

  /** Commands from before a change may still apply; a new one waits until they are settled. */
  get carrying(): boolean {
    return this.carried > 0;
  }

  /** A command of `bytes` went to the relay; `clickedAt` is when the player issued it, before any
   *  outbound wait. */
  issued(clickedAt: number, bytes: number): void {
    this.stamps.push({ clickedAt, bytes });
    this.stampBytes += bytes;
  }

  /** One of this seat's commands applied on a tick that just ran. */
  applied(now: number): void {
    if (this.takeCarried()) return;
    const stamp = this.settle(this.stamps.shift());
    if (stamp === undefined) return;
    const ms = now - stamp.clickedAt;
    this.latestMs = ms;
    this.smoothedMs = this.smoothedMs === null ? ms : this.smoothedMs + SMOOTHING * (ms - this.smoothedMs);
  }

  /** Every client dropped one of this seat's commands from a frame, the oldest in flight. */
  dropped(): void {
    if (!this.takeCarried()) this.settle(this.stamps.shift());
  }

  /** The relay refused a command. It answers on receipt, before any later command of this seat can
   *  have come back, so the refused one is most likely the newest stamp. */
  refused(): void {
    if (this.settle(this.stamps.pop()) === undefined) this.takeCarried();
  }

  /** The socket was replaced or another world adopted: what is in flight is carried from here, sent
   *  under an input delay of `delayTicks`. */
  carryOver(delayTicks: number): void {
    this.carried += this.stamps.length;
    this.forgetStamps();
    if (this.carried === 0) return;
    this.carryDelayTicks = Math.max(this.carryDelayTicks, delayTicks);
    this.carriedUntil = null;
  }

  /** The relay stood at `relayTick` after the change, which bounds where a carried command landed;
   *  `clientTick` is where this client's world stands, null without one. */
  relayAt(relayTick: number, delayTicks: number, clientTick: number | null): void {
    if (this.carried === 0 || this.carriedUntil !== null) return;
    this.carriedUntil = relayTick + Math.max(MIN_APPLY_LEAD_TICKS, this.carryDelayTicks, delayTicks);
    if (clientTick !== null) this.ran(clientTick);
  }

  /** This client's world ran `tick`, after applying its commands. */
  ran(tick: number): void {
    if (this.carriedUntil !== null && tick >= this.carriedUntil) this.clearCarried();
  }

  /** Commands in flight for a room this client left never come back. */
  forgetInFlight(): void {
    this.forgetStamps();
    this.clearCarried();
  }

  private settle(stamp: Stamp | undefined): Stamp | undefined {
    if (stamp !== undefined) this.stampBytes -= stamp.bytes;
    return stamp;
  }

  private forgetStamps(): void {
    this.stamps.length = 0;
    this.stampBytes = 0;
  }

  private takeCarried(): boolean {
    if (this.carried === 0) return false;
    this.carried--;
    if (this.carried === 0) this.clearCarried();
    return true;
  }

  private clearCarried(): void {
    this.carried = 0;
    this.carryDelayTicks = 0;
    this.carriedUntil = null;
  }
}
