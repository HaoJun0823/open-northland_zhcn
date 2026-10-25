import { AUTO_INITIAL_BUFFER_TICKS, type ClientLoad, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { KICK_COUNTDOWN_MS, SILENT_AFTER_MS } from '../../../src/index.js';
import {
  framesIn,
  GOVERN_RELEASE_MS,
  SLOW_AT_ONCE_MS,
  SLOW_GRACE_MS,
  SLOW_WAIT_AFTER_MS,
} from '../../../src/relay/timing/governor.js';
import {
  digest,
  LOAD,
  type MessageStage,
  type Peer,
  roomOfThree,
  SETTINGS,
} from '../../support/message-stage.js';

/** A seat that cannot keep up: governed first, waited for once it has stayed slow for the bound. */

/** A client whose sim tick costs a wall second: it sustains a twelfth of speed 1, under the floor. */
const CHRONIC_LOAD: ClientLoad = { tickMs: 1000, buffered: 0 };
/** Ticks the slow member trails by: past the slow-at-once threshold, so it is slow from the start. */
const FAR_BEHIND_TICKS = framesIn(SLOW_GRACE_MS * 2, SETTINGS.speed);
const RELEASE_TICKS = framesIn(GOVERN_RELEASE_MS, SETTINGS.speed);
/** Wall time a member trailing from the first frame takes to be slow at once, beyond the reserve the
 *  room starts with. */
const SLOW_ONSET_MS = (framesIn(SLOW_AT_ONCE_MS, SETTINGS.speed) + 1 + AUTO_INITIAL_BUFFER_TICKS) * TICK_MS;
/** Wall time from the first frame until the room waits for a member slow from the start. */
const WAITED_AFTER_MS = SLOW_ONSET_MS + SLOW_WAIT_AFTER_MS;
/** Wall time of a few advances, the margin around a boundary. */
const MARGIN_MS = TICK_MS * 4;

const acked = new WeakMap<Peer, number>();
const lastTick = (peer: Peer): number => peer.last('frame')?.tick ?? 0;

function ackTo(peer: Peer, tick: number, load: ClientLoad): void {
  const from = acked.get(peer) ?? 0;
  for (let t = from + 1; t <= tick; t++)
    peer.send({ kind: 'ack', tick: t, digest: digest(1), world: 0, load });
  acked.set(peer, Math.max(from, tick));
}

/** Move the clock with every peer heard, `leads` acknowledging each frame and `trailer` staying
 *  `behind` ticks short of the frames it holds back anyway, the room's reserve: the stage's pongs
 *  answer at once, so no frames are in flight on its links. */
function trail(
  s: MessageStage,
  leads: readonly Peer[],
  trailer: Peer,
  behind: number,
  ms: number,
  load = CHRONIC_LOAD,
): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    for (const peer of [...leads, trailer]) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
    }
    for (const lead of leads) ackTo(lead, lastTick(lead), LOAD);
    ackTo(trailer, lastTick(trailer) - behind - (trailer.last('responsiveness')?.bufferTicks ?? 0), load);
  }
}

describe('a member that stays slow', () => {
  it('is waited for once slow for the bound, holds the clock, and can be voted out after its countdown', () => {
    const s = roomOfThree();
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, WAITED_AFTER_MS - MARGIN_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek', cause: 'load' });
    s.a.send({ kind: 'kick', player: 1, yes: true });
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'notWaitedFor', nick: 'Bartek' });

    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, MARGIN_MS * 2);
    const [wait] = s.a.last('waiting')?.for ?? [];
    expect(wait).toMatchObject({ nick: 'Bartek', reason: 'slow' });
    expect(wait?.voteAfterMs).toBeGreaterThan(KICK_COUNTDOWN_MS - MARGIN_MS * 2);
    const held = lastTick(s.a);
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, MARGIN_MS);
    expect(lastTick(s.a)).toBe(held);

    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, KICK_COUNTDOWN_MS);
    s.a.send({ kind: 'kick', player: 1, yes: true });
    s.c.send({ kind: 'kick', player: 1, yes: true });
    expect(s.a.last('kicked')).toMatchObject({ player: 1, nick: 'Bartek', cause: 'vote' });
  });

  it('stops being waited for and votable after catching up, keeping its load limit until recovery', () => {
    const s = roomOfThree();
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, WAITED_AFTER_MS + KICK_COUNTDOWN_MS + MARGIN_MS);
    expect(s.a.last('waiting')?.for).toEqual([{ nick: 'Bartek', reason: 'slow', voteAfterMs: 0 }]);
    s.a.send({ kind: 'kick', player: 1, yes: true });
    expect(s.c.last('kickVote')).toMatchObject({ nick: 'Bartek', yes: ['Ania'], needed: 2 });

    trail(s, [s.a, s.c], s.b, RELEASE_TICKS, MARGIN_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek', cause: 'load' });
    s.c.send({ kind: 'kick', player: 1, yes: true });
    expect(s.c.last('rejected')?.reason).toEqual({ code: 'notWaitedFor', nick: 'Bartek' });
    expect(s.a.of('kicked')).toEqual([]);
    const resumed = lastTick(s.a);
    trail(s, [s.a, s.c], s.b, RELEASE_TICKS, MARGIN_MS * 2, LOAD);
    expect(lastTick(s.a)).toBeGreaterThan(resumed);
    expect(s.a.last('clock')?.governed).toBeNull();
  });

  it('does not count a hold for its silence toward the bound', () => {
    const s = roomOfThree();
    // Unheard for `SILENT_AFTER_MS` before the hold begins, which counts as slow like any other time.
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, WAITED_AFTER_MS - SILENT_AFTER_MS - MARGIN_MS * 2);
    const unheardMs = SILENT_AFTER_MS * 2;
    for (let elapsed = 0; elapsed < unheardMs; elapsed += TICK_MS) {
      s.advance(TICK_MS);
      for (const peer of [s.a, s.c]) {
        const ping = peer.last('ping');
        if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
      }
    }
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'silent' }]);
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, MARGIN_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });
    trail(s, [s.a, s.c], s.b, FAR_BEHIND_TICKS, MARGIN_MS * 2);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'slow' }]);
  });
});
