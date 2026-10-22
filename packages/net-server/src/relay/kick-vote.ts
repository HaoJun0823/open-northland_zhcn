import { kickVotesNeeded, type RelayReason, type ServerMessage } from '@open-northland/net-protocol';
import type { Member } from './member.js';
import type { Waiting } from './waiting.js';

const MS_PER_SECOND = 1000;

export type KickTally = Extract<ServerMessage, { kind: 'kickVote' }>;

export type KickOutcome =
  | { readonly refused: RelayReason }
  | { readonly tally: KickTally; readonly kicked: Member | null };

/** A vote that passed: the member it removes and the seat it held. */
export interface PassedKick {
  readonly target: Member;
  readonly player: number;
}

/** Whether the room would wait for the member now. The waited set is refreshed once per relay poll,
 *  so a target that answered since then is still in it. */
export type WaitedNow = (member: Member) => boolean;

/**
 * Who said yes to kicking each waited member. A yes counts only while its voter is connected, and the
 * vote passes once the counted yeses reach a strict majority of the connected members other than the
 * target, while the room would still wait for the target now with its vote open. The yeses outlive a
 * wait while the target still owes waited time, so the yeses of a target dropping in short waits add
 * up across them; a departed token loses its votes.
 */
export class KickVotes {
  /** Voter tokens by target token. */
  private readonly ballots = new Map<string, Set<string>>();
  /** The tally each target's vote was last broadcast with. */
  private readonly announced = new Map<string, KickTally>();

  /** `voter`'s yes for the member in seat `player`, or with `yes` false its withdrawal, allowed once
   *  that member's countdown is over. A repeated yes counts once. */
  cast(
    members: ReadonlyMap<string, Member>,
    waiting: Waiting,
    voter: Member,
    player: number,
    yes: boolean,
    now: number,
    waitedNow: WaitedNow,
  ): KickOutcome {
    if (voter.seat === null) return { refused: { code: 'seatRequired' } };
    const target = [...members.values()].find((member) => member.seat === player);
    if (target === undefined) return { refused: { code: 'seatEmpty', player } };
    if (target === voter) return { refused: { code: 'voteSelf' } };
    if (!waiting.isWaitedFor(target.token) || !waitedNow(target))
      return { refused: { code: 'notWaitedFor', nick: target.nick } };
    if (!waiting.voteOpen(target.token, now)) {
      return {
        refused: {
          code: 'voteNotOpen',
          seconds: Math.ceil(waiting.voteAfterMs(target.token, now) / MS_PER_SECOND),
        },
      };
    }
    const voters = this.ballots.get(target.token) ?? new Set<string>();
    if (yes) voters.add(voter.token);
    else if (!voters.delete(voter.token)) return { refused: { code: 'noVoteToWithdraw', nick: target.nick } };
    this.ballots.set(target.token, voters);
    const tally = tallyOf(members, target, player, voters);
    this.announced.set(target.token, tally);
    return { tally, kicked: passes(tally) ? target : null };
  }

  /** Count every vote again after the connected members changed. Returns the tallies that moved
   *  since they were last broadcast, and the first vote that now passes. */
  recount(
    members: ReadonlyMap<string, Member>,
    waiting: Waiting,
    now: number,
    waitedNow: WaitedNow,
  ): {
    readonly moved: readonly KickTally[];
    readonly passed: PassedKick | null;
  } {
    const moved: KickTally[] = [];
    let passed: PassedKick | null = null;
    for (const [token, voters] of this.ballots) {
      const target = members.get(token);
      if (target === undefined || target.seat === null || !waiting.isWaitedFor(token)) continue;
      const tally = tallyOf(members, target, target.seat, voters);
      if (!sameTally(tally, this.announced.get(token))) {
        this.announced.set(token, tally);
        moved.push(tally);
      }
      if (passed === null && passes(tally) && waiting.voteOpen(token, now) && waitedNow(target))
        passed = { target, player: target.seat };
    }
    return { moved, passed };
  }

  /** Every open vote as it was last broadcast, for a member that missed the broadcasts. */
  openTallies(): readonly KickTally[] {
    return [...this.announced.values()];
  }

  /** Drop the yeses against every member that owes no waited time any more. A vote whose target is
   *  not waited for is hidden, as clients drop its tally with the wait; returns the tally of each
   *  hidden vote whose target is waited for again, to show it once more. */
  follow(members: ReadonlyMap<string, Member>, waiting: Waiting): readonly KickTally[] {
    const shown: KickTally[] = [];
    for (const [token, voters] of this.ballots) {
      if (!waiting.owes(token)) {
        this.ballots.delete(token);
        this.announced.delete(token);
      } else if (!waiting.isWaitedFor(token)) {
        this.announced.delete(token);
      } else if (!this.announced.has(token)) {
        const target = members.get(token);
        if (target === undefined || target.seat === null) continue;
        const tally = tallyOf(members, target, target.seat, voters);
        this.announced.set(token, tally);
        shown.push(tally);
      }
    }
    return shown;
  }

  /** A departed token keeps neither a vote against it nor its yes in another. */
  forget(token: string): void {
    this.ballots.delete(token);
    this.announced.delete(token);
    for (const voters of this.ballots.values()) voters.delete(token);
  }
}

function tallyOf(
  members: ReadonlyMap<string, Member>,
  target: Member,
  player: number,
  voters: ReadonlySet<string>,
): KickTally {
  let others = 0;
  for (const member of members.values())
    if (member.seat !== null && member.connected && member !== target) others++;
  const yes = [...voters].flatMap((token) => {
    const member = members.get(token);
    return member?.seat != null && member.connected && member !== target ? [member.nick] : [];
  });
  return { kind: 'kickVote', player, nick: target.nick, yes, needed: kickVotesNeeded(others) };
}

function passes(tally: KickTally): boolean {
  return tally.yes.length >= tally.needed;
}

function sameTally(a: KickTally, b: KickTally | undefined): boolean {
  return (
    b !== undefined &&
    a.needed === b.needed &&
    a.yes.length === b.yes.length &&
    a.yes.every((nick, i) => nick === b.yes[i])
  );
}
