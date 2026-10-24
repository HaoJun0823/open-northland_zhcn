import { describe, expect, it } from 'vitest';
import { KickVotes } from '../src/relay/game/kick-vote.js';
import { KICK_COUNTDOWN_MS, WAIT_FORGIVENESS, Waiting } from '../src/relay/game/waiting.js';
import { createMember, type Member } from '../src/relay/member.js';

const TARGET_SEAT = 0;
const STILL_WAITED = () => true;
const ANSWERED = () => false;

/** `count` seated members, seat i for the i-th, with the first waited for and its vote open. */
function room(count: number) {
  const peers = Array.from({ length: count }, (_, seat) => {
    const member = createMember(String(seat), `Player${seat}`, 0, { delayTicks: 1, roundTripMs: 0 });
    member.seat = seat;
    return member;
  });
  const members = new Map(peers.map((member) => [member.token, member]));
  const [target] = peers;
  if (target === undefined) throw new Error('no target');
  const waiting = new Waiting();
  waiting.update([{ token: target.token, nick: target.nick, reason: 'gone' }], 0);
  target.connected = false;
  const votes = new KickVotes();
  const cast = (voter: Member | undefined, yes = true, waitedNow = STILL_WAITED) => {
    if (voter === undefined) throw new Error('no voter');
    return votes.cast(members, waiting, voter, TARGET_SEAT, yes, KICK_COUNTDOWN_MS, waitedNow);
  };
  return { peers, members, waiting, votes, cast, target };
}

describe('kick electorate', () => {
  it.each(['disconnected', 'removed'] as const)('excludes votes from %s members', (status) => {
    const { peers, members, cast, target } = room(7);
    const [, a, b, c, d] = peers;
    for (const voter of [a, b]) expect(cast(voter)).toMatchObject({ kicked: null });
    for (const voter of [a, b]) {
      if (voter === undefined) continue;
      if (status === 'removed') members.delete(voter.token);
      else voter.connected = false;
    }
    // Four connected others (removed or dropped voters are not among them): three yeses pass.
    expect(cast(c)).toMatchObject({ tally: { yes: [c?.nick], needed: 3 }, kicked: null });
    expect(cast(d)).toMatchObject({ tally: { needed: 3 }, kicked: null });
    expect(cast(peers[5])).toMatchObject({ kicked: target });
  });

  it('needs both of two remaining players, and 2 of 3', () => {
    const three = room(3);
    expect(three.cast(three.peers[1])).toMatchObject({ tally: { needed: 2 }, kicked: null });
    expect(three.cast(three.peers[2])).toMatchObject({ kicked: three.target });

    const four = room(4);
    expect(four.cast(four.peers[1])).toMatchObject({ tally: { needed: 2 }, kicked: null });
    expect(four.cast(four.peers[2])).toMatchObject({ kicked: four.target });
  });
});

describe('kick withdrawal', () => {
  it('takes a yes back and refuses a withdrawal from a member that never voted', () => {
    const { peers, cast, target } = room(4);
    const [, a, b, c] = peers;
    expect(cast(b, false)).toEqual({ refused: { code: 'noVoteToWithdraw', nick: 'Player0' } });
    cast(a);
    expect(cast(a, false)).toEqual({
      tally: { kind: 'kickVote', player: TARGET_SEAT, nick: 'Player0', yes: [], needed: 2 },
      kicked: null,
    });
    expect(cast(a, false)).toMatchObject({ refused: { code: 'noVoteToWithdraw' } });
    cast(b);
    expect(cast(c)).toMatchObject({ tally: { yes: ['Player2', 'Player3'] }, kicked: target });
  });
});

describe('kick recount', () => {
  it('stops counting a dropped voter, counts it again on its return, and passes when the electorate shrinks', () => {
    const { peers, members, waiting, votes, cast, target } = room(5);
    const [, a, b, c, d] = peers;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('peers');
    cast(a);
    cast(b);
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS, STILL_WAITED)).toEqual({
      moved: [],
      passed: null,
    });

    a.connected = false;
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS, STILL_WAITED)).toEqual({
      moved: [{ kind: 'kickVote', player: TARGET_SEAT, nick: target.nick, yes: [b.nick], needed: 2 }],
      passed: null,
    });
    a.connected = true;
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS, STILL_WAITED).moved).toEqual([
      { kind: 'kickVote', player: TARGET_SEAT, nick: target.nick, yes: [a.nick, b.nick], needed: 3 },
    ]);

    // A non-voter dropping leaves three connected others: two yeses are a majority now.
    d.connected = false;
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS, STILL_WAITED)).toMatchObject({
      moved: [{ yes: [a.nick, b.nick], needed: 2 }],
      passed: { target, player: TARGET_SEAT },
    });
  });

  it('passes no vote against a target that answered since the waited set was refreshed', () => {
    const { peers, cast, target } = room(3);
    const [, a, b] = peers;
    cast(a);
    expect(cast(b, true, ANSWERED)).toEqual({ refused: { code: 'notWaitedFor', nick: target.nick } });
    expect(cast(b)).toMatchObject({ kicked: target });

    const again = room(5);
    const [, c, d, e] = again.peers;
    again.cast(c);
    again.cast(d);
    if (e === undefined) throw new Error('peers');
    e.connected = false;
    expect(again.votes.recount(again.members, again.waiting, KICK_COUNTDOWN_MS, ANSWERED)).toMatchObject({
      moved: [{ needed: 2 }],
      passed: null,
    });
    expect(again.votes.recount(again.members, again.waiting, KICK_COUNTDOWN_MS, STILL_WAITED).passed).toEqual(
      {
        target: again.target,
        player: TARGET_SEAT,
      },
    );
  });

  it('hides the vote while its target is not waited for, and closes it once the target owes nothing', () => {
    const { members, peers, waiting, votes, cast, target } = room(3);
    const [, a, b] = peers;
    if (a === undefined || b === undefined) throw new Error('peers');
    cast(a);
    waiting.update([], KICK_COUNTDOWN_MS);
    expect(votes.follow(members, waiting)).toEqual([]);
    expect(votes.openTallies()).toEqual([]);
    b.connected = false;
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS, STILL_WAITED)).toEqual({
      moved: [],
      passed: null,
    });
    b.connected = true;

    const back = KICK_COUNTDOWN_MS + 1;
    waiting.update([{ token: target.token, nick: target.nick, reason: 'gone' }], back);
    const shown = { kind: 'kickVote', player: TARGET_SEAT, nick: target.nick, yes: [a.nick], needed: 2 };
    expect(votes.follow(members, waiting)).toEqual([shown]);
    expect(votes.follow(members, waiting)).toEqual([]);

    const forgivenAt = back + KICK_COUNTDOWN_MS / WAIT_FORGIVENESS;
    waiting.update([], back);
    waiting.update([], forgivenAt);
    expect(waiting.owes(target.token)).toBe(false);
    votes.follow(members, waiting);
    waiting.update([{ token: target.token, nick: target.nick, reason: 'gone' }], forgivenAt);
    expect(votes.follow(members, waiting)).toEqual([]);
  });

  it('passes no vote on a recount while its target is waited for again but its countdown runs', () => {
    const { members, peers, waiting, votes, cast, target } = room(5);
    const [, a, b, , d] = peers;
    if (d === undefined) throw new Error('peers');
    cast(a);
    cast(b);
    waiting.update([], KICK_COUNTDOWN_MS);
    const back = KICK_COUNTDOWN_MS * 2;
    waiting.update([{ token: target.token, nick: target.nick, reason: 'gone' }], back);
    expect(waiting.voteOpen(target.token, back)).toBe(false);
    // Two yeses meet the need of the three others left connected, but the countdown has not run out.
    d.connected = false;
    expect(votes.recount(members, waiting, back, STILL_WAITED).passed).toBeNull();
    expect(votes.recount(members, waiting, KICK_COUNTDOWN_MS * 3, STILL_WAITED).passed).toEqual({
      target,
      player: TARGET_SEAT,
    });
  });
});

describe('a yes cast during a long absence', () => {
  /** Wall time the target is gone for: ten countdowns. */
  const LONG_ABSENCE_MS = 10 * KICK_COUNTDOWN_MS;
  /** Wall time the target plays on for after its return before its next short wait. */
  const PLAYED_ON_MS = 60 * KICK_COUNTDOWN_MS;

  it('owes at most one countdown, so the yes is gone by its next short wait an hour later', () => {
    const { members, peers, waiting, votes, cast, target } = room(3);
    const [, a] = peers;
    const waited = [{ token: target.token, nick: target.nick, reason: 'gone' as const }];
    expect(cast(a)).toMatchObject({ kicked: null });
    waiting.update(waited, LONG_ABSENCE_MS);
    expect(waiting.voteAfterMs(target.token, LONG_ABSENCE_MS)).toBe(0);

    target.connected = true;
    waiting.update([], LONG_ABSENCE_MS);
    votes.follow(members, waiting);
    const forgivenAt = LONG_ABSENCE_MS + KICK_COUNTDOWN_MS / WAIT_FORGIVENESS;
    waiting.update([], forgivenAt);
    expect(waiting.owes(target.token)).toBe(false);
    votes.follow(members, waiting);

    const hiccupAt = LONG_ABSENCE_MS + PLAYED_ON_MS;
    waiting.update([{ token: target.token, nick: target.nick, reason: 'silent' }], hiccupAt);
    expect(waiting.voteOpen(target.token, hiccupAt)).toBe(false);
    expect(votes.follow(members, waiting)).toEqual([]);
  });
});
