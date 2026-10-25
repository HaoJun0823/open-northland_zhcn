import type { GovernedClock, GovernorCause, WaitReason } from '@open-northland/net-protocol';
import type { Member } from '../member.js';
import { msFields, type RelayLog } from '../relay-log.js';
import type { Waited } from './waiting.js';

/** A hold or a governed run shorter than this is a hiccup: the room status counts it, and it gets no
 *  line of its own. */
export const NOTABLE_EPISODE_MS = 5000;

/** The running clock as one update of the waited set left it. */
export interface ClockState {
  readonly tick: number;
  /** The requested speed. */
  readonly speed: number;
  readonly paused: boolean;
  readonly waited: readonly Waited[];
  readonly governed: GovernedClock | null;
}

/** The clock over one room status interval. `holds` counts the holds begun in it. */
export interface ClockTotals {
  heldMs: number;
  holds: number;
  governedMs: number;
  minSpeed: number | null;
  pausedMs: number;
}

/** One hold or governed run: the tick it began on, its length, and each member's share of it by wait
 *  reason or governor cause. */
interface Episode<K extends string> {
  readonly tick: number;
  ms: number;
  readonly shares: Map<string, Partial<Record<K, number>>>;
}

/**
 * The holds and governed runs of a running clock, for the log: one `held` or `governed` line when a
 * notable one ends, and totals for the room status. The time between two updates counts towards the
 * state the earlier one saw, so the work per update is one addition per waited member.
 */
export class ClockLog {
  private state: ClockState | null = null;
  private at: number;
  private hold: Episode<WaitReason> | null = null;
  /** A governed run, with the requested speed and the lowest governed one during it. */
  private run: (Episode<GovernorCause> & { speed: number; minSpeed: number }) | null = null;
  /** The member the open run governs for, found by nick once per change of it. */
  private governing: Member | null = null;
  private totals = noTotals();

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly log: RelayLog,
    now: number,
  ) {
    this.at = now;
  }

  /** Whom the clock holds for now; empty when it does not run. */
  get waited(): readonly Waited[] {
    return this.state?.waited ?? [];
  }

  /** The clock as it stands at `now`, or null while it does not run; null ends any open episode. */
  observe(state: ClockState | null, now: number): void {
    this.account(now);
    this.state = state;
    if (state === null || state.waited.length === 0) this.endHold();
    else if (this.hold === null) {
      this.hold = { tick: state.tick, ms: 0, shares: new Map() };
      this.totals.holds++;
    }
    const governed = state?.governed ?? null;
    if (state === null || governed === null) {
      this.endRun();
      return;
    }
    this.run ??= { tick: state.tick, ms: 0, shares: new Map(), speed: state.speed, minSpeed: governed.speed };
    this.run.speed = state.speed;
    this.run.minSpeed = Math.min(this.run.minSpeed, governed.speed);
    this.totals.minSpeed = Math.min(this.totals.minSpeed ?? governed.speed, governed.speed);
    if (this.governing?.nick !== governed.nick) this.governing = memberNamed(this.members, governed.nick);
  }

  /** The totals through `now`; the next interval starts from none, at the speed still governed. */
  takeTotals(now: number): ClockTotals {
    this.account(now);
    const totals = this.totals;
    this.totals = noTotals();
    this.totals.minSpeed = this.state?.governed?.speed ?? null;
    return totals;
  }

  private account(now: number): void {
    const ms = now - this.at;
    this.at = now;
    const state = this.state;
    if (state === null || ms <= 0) return;
    if (state.paused) this.totals.pausedMs += ms;
    if (this.hold !== null) {
      this.hold.ms += ms;
      this.totals.heldMs += ms;
      for (const { token, nick, reason } of state.waited) {
        addShare(this.hold.shares, nick, reason, ms);
        const waited = this.members.get(token)?.figures.waitedMs;
        if (waited !== undefined) waited[reason] = (waited[reason] ?? 0) + ms;
      }
    }
    if (this.run !== null && state.governed !== null) {
      this.run.ms += ms;
      this.totals.governedMs += ms;
      addShare(this.run.shares, state.governed.nick, state.governed.cause, ms);
      if (this.governing !== null) this.governing.figures.governedMs += ms;
    }
  }

  private endHold(): void {
    const hold = this.hold;
    this.hold = null;
    if (hold === null || hold.ms < NOTABLE_EPISODE_MS) return;
    this.log('held', { tick: hold.tick, ms: Math.round(hold.ms), for: shareFields(hold.shares) });
  }

  private endRun(): void {
    const run = this.run;
    this.run = null;
    this.governing = null;
    if (run === null || run.ms < NOTABLE_EPISODE_MS) return;
    this.log('governed', {
      tick: run.tick,
      ms: Math.round(run.ms),
      speed: run.speed,
      minSpeed: run.minSpeed,
      for: shareFields(run.shares),
    });
  }
}

function noTotals(): ClockTotals {
  return { heldMs: 0, holds: 0, governedMs: 0, minSpeed: null, pausedMs: 0 };
}

function addShare<K extends string>(
  shares: Map<string, Partial<Record<K, number>>>,
  nick: string,
  key: K,
  ms: number,
): void {
  let share = shares.get(nick);
  if (share === undefined) {
    share = {};
    shares.set(nick, share);
  }
  share[key] = (share[key] ?? 0) + ms;
}

function shareFields<K extends string>(shares: ReadonlyMap<string, Partial<Record<K, number>>>) {
  return [...shares].map(([nick, share]) => ({ nick, ...msFields(share) }));
}

function memberNamed(members: ReadonlyMap<string, Member>, nick: string): Member | null {
  for (const member of members.values()) if (member.nick === nick) return member;
  return null;
}
