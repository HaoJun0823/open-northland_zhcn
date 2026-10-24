import {
  MAX_RESPONSIVENESS_BUFFER_TICKS,
  type ResponsivenessMode,
  type ResponsivenessState,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { isSynced, type Member } from '../member.js';

/** These are room pacing choices, independent of each member's existing command delivery budget. */
const MANUAL_TICKS = { responsive: 1, balanced: 2, smooth: 3 } as const;
/** The automatic reserve before the room has measured its links. */
export const AUTO_INITIAL_BUFFER_TICKS = 2;
/** How long a lower target must persist for each tick the reserve falls. */
const LOWER_AFTER_MS = 10_000;
/** How long a higher target must persist for each tick the reserve rises. A link sample arrives once
 *  a second, so one late pong, whose share of the smoothed jitter fades over a few samples, lifts the
 *  reserve by a tick or so instead of to the cap. */
const RAISE_AFTER_MS = 1000;
/** The RTT margin is this share of the round trip, capped. */
const RTT_MARGIN_SHARE = 0.1;
const RTT_MARGIN_CAP_MS = 25;
/** Measured jitter is reserved this many times over. */
const JITTER_RESERVE_FACTOR = 2;

type MeasuredMember = Pick<
  Member,
  'seat' | 'connected' | 'loaded' | 'outOfSync' | 'linkMeasured' | 'roundTripMs' | 'jitterMs'
>;

/** A small capped RTT margin covers unobserved variation; measured jitter determines the reserve.
 *  Stable latency is already covered by the member's input delay and is not buffered twice. */
export function automaticBufferTicks(members: Iterable<MeasuredMember>, speed: number): number {
  let target = 1;
  for (const member of members) {
    if (member.seat === null || !isSynced(member)) continue;
    if (!member.linkMeasured) {
      target = Math.max(target, AUTO_INITIAL_BUFFER_TICKS);
      continue;
    }
    const reserveMs =
      Math.min(RTT_MARGIN_CAP_MS, member.roundTripMs * RTT_MARGIN_SHARE) +
      member.jitterMs * JITTER_RESERVE_FACTOR;
    target = Math.max(target, Math.ceil((reserveMs * speed) / TICK_MS));
  }
  return Math.min(MAX_RESPONSIVENESS_BUFFER_TICKS, target);
}

export class Responsiveness {
  private state: ResponsivenessState = { mode: 'auto', bufferTicks: AUTO_INITIAL_BUFFER_TICKS, by: null };
  private lowerSince: number | null = null;
  private raiseSince: number | null = null;

  get bufferTicks(): number {
    return this.state.bufferTicks;
  }

  message(): Extract<ServerMessage, { kind: 'responsiveness' }> {
    return { kind: 'responsiveness', ...this.state };
  }

  select(mode: ResponsivenessMode, by: string): boolean {
    if (mode === this.state.mode) return false;
    this.state = { mode, bufferTicks: mode === 'auto' ? AUTO_INITIAL_BUFFER_TICKS : MANUAL_TICKS[mode], by };
    this.lowerSince = null;
    this.raiseSince = null;
    return true;
  }

  observe(members: Iterable<MeasuredMember>, speed: number | null, now: number): boolean {
    if (this.state.mode !== 'auto' || speed === null) {
      this.lowerSince = null;
      this.raiseSince = null;
      return false;
    }
    const target = automaticBufferTicks(members, speed);
    const raise = target > this.state.bufferTicks;
    if (!raise) this.raiseSince = null;
    if (target >= this.state.bufferTicks) this.lowerSince = null;
    if (target === this.state.bufferTicks) return false;
    if (raise) {
      this.raiseSince ??= now;
      if (now - this.raiseSince < RAISE_AFTER_MS) return false;
      // The next tick up needs its own second of a higher target.
      this.raiseSince = now;
    } else {
      this.lowerSince ??= now;
      if (now - this.lowerSince < LOWER_AFTER_MS) return false;
      this.lowerSince = null;
    }
    this.state = { ...this.state, bufferTicks: this.state.bufferTicks + (raise ? 1 : -1) };
    return true;
  }
}
