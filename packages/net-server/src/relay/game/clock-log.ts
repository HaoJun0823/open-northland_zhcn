import type { GovernedClock, GovernorCause, WaitReason } from '@open-northland/net-protocol';
import type { Member } from '../member.js';
import { msFields, type RelayLog } from '../relay-log.js';
import type { Waited } from './waiting.js';

/** A hold, governed run or pause shorter than this is a hiccup: the room status counts it, and it gets
 *  no line of its own. */
export const NOTABLE_EPISODE_MS = 5000;
/** A governed run that starts again within this of the last one's end belongs to its episode: a member
 *  that cannot keep up at the requested speed is paced again a few seconds after each release, and
 *  that is one slowdown. The episode's line comes once the clock has run this long without it. */
export const GOVERNED_GAP_MS = 60_000;

/** The running clock as one update of the waited set left it. */
export interface ClockState {
  readonly tick: number;
  /** The requested speed. */
  readonly speed: number;
  readonly paused: boolean;
  /** Who paused the clock, while it is paused. */
  readonly pausedBy: string | null;
  readonly waited: readonly Waited[];
  readonly governed: GovernedClock | null;
}

/** The clock over one room status interval. `holds` counts the holds begun in it; governed time counts
 *  only while the clock runs, neither held nor paused. */
export interface ClockTotals {
  heldMs: number;
  holds: number;
  governedMs: number;
  minSpeed: number | null;
  pausedMs: number;
}

/** One hold or governed episode: the tick it began on, its length, and each member's share of it by
 *  wait reason or governor cause. */
interface Episode<K extends string> {
  readonly tick: number;
  ms: number;
  readonly shares: Map<string, Partial<Record<K, number>>>;
}

/** A governed episode, with the requested speed and the lowest governed one during it, its runs, and
 *  since when and from which tick the clock has run without the governor; null while it is governed. */
interface GovernedEpisode extends Episode<GovernorCause> {
  speed: number;
  minSpeed: number;
  runs: number;
  freeSince: number | null;
  endTick: number;
}

/**
 * The holds, governed episodes and pauses of a running clock, for the log: one `held`, `governed` or
 * `paused` line when a notable one ends, and totals for the room status. The time between two updates
 * counts towards the state the earlier one saw, so the work per update is one addition per waited
 * member.
 */
export class ClockLog {
  private state: ClockState | null = null;
  private at: number;
  private hold: Episode<WaitReason> | null = null;
  private run: GovernedEpisode | null = null;
  private pause: { readonly tick: number; readonly by: string | null; ms: number } | null = null;
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

  /** How long the open hold has lasted, as of the last update; null when none is open. */
  get holdMs(): number | null {
    return this.hold?.ms ?? null;
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
    if (state === null || !state.paused) this.endPause();
    else this.pause ??= { tick: state.tick, by: state.pausedBy, ms: 0 };
    if (state === null) this.endRun();
    else this.followRun(state, now);
  }

  /** A governed run starts the episode or continues it; the clock running `GOVERNED_GAP_MS` without
   *  the governor ends it. */
  private followRun(state: ClockState, now: number): void {
    const { governed } = state;
    let run = this.run;
    if (governed === null) {
      this.governing = null;
      if (run === null) return;
      if (run.freeSince === null) {
        run.freeSince = now;
        run.endTick = state.tick;
      } else if (now - run.freeSince >= GOVERNED_GAP_MS) this.endRun();
      return;
    }
    if (run === null) {
      run = {
        tick: state.tick,
        ms: 0,
        shares: new Map(),
        speed: state.speed,
        minSpeed: governed.speed,
        runs: 1,
        freeSince: null,
        endTick: state.tick,
      };
      this.run = run;
    } else if (run.freeSince !== null) {
      run.freeSince = null;
      run.runs++;
    }
    run.speed = state.speed;
    run.minSpeed = Math.min(run.minSpeed, governed.speed);
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
    if (this.pause !== null) this.pause.ms += ms;
    if (this.hold !== null) {
      this.hold.ms += ms;
      this.totals.heldMs += ms;
      for (const { token, nick, reason } of state.waited) {
        addShare(this.hold.shares, nick, reason, ms);
        const waited = this.members.get(token)?.figures.waitedMs;
        if (waited !== undefined) waited[reason] = (waited[reason] ?? 0) + ms;
      }
    }
    if (this.run !== null && state.governed !== null && this.hold === null && !state.paused) {
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

  private endPause(): void {
    const pause = this.pause;
    this.pause = null;
    if (pause === null || pause.ms < NOTABLE_EPISODE_MS) return;
    this.log('paused', {
      tick: pause.tick,
      ms: Math.round(pause.ms),
      ...(pause.by === null ? {} : { by: pause.by }),
    });
  }

  private endRun(): void {
    const run = this.run;
    this.run = null;
    this.governing = null;
    if (run === null || run.ms < NOTABLE_EPISODE_MS) return;
    this.log('governed', {
      tick: run.tick,
      ...(run.freeSince === null ? {} : { endTick: run.endTick }),
      ms: Math.round(run.ms),
      ...(run.runs === 1 ? {} : { runs: run.runs }),
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
