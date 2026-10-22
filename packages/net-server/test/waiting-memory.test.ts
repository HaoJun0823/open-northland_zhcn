import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { KICK_COUNTDOWN_MS, SILENT_AFTER_MS } from '../src/index.js';
import { WAIT_FORGIVENESS, Waiting } from '../src/relay/waiting.js';
import { digest, LOAD, type Peer, startedRoom, startingRoom } from './support/message-stage.js';

const TOKEN = 'token-of-bartek';
const WAITED = [{ token: TOKEN, nick: 'Bartek', reason: 'silent' as const }];
/** A wait that uses half the countdown. */
const HALF_COUNTDOWN_MS = KICK_COUNTDOWN_MS / 2;
/** Wall time between a flapping link's bursts: it is silent for the last part of each. */
const BURST_EVERY_MS = 6000;
/** Wall time the flapping link is run for at most: well past the vote it should reach. */
const FLAP_RUN_MS = 5 * 60_000;
/** Wall time the members load for before the clock starts, every one of them waited for meanwhile. */
const LONG_LOAD_MS = 40_000;

describe('the waited time a member owes', () => {
  it('keeps what a wait used of the countdown, and forgives it while the member is not waited for', () => {
    const waiting = new Waiting();
    waiting.update(WAITED, 0);
    waiting.update([], HALF_COUNTDOWN_MS);
    expect(waiting.isWaitedFor(TOKEN)).toBe(false);

    const answeredMs = 100_000;
    const forgivenMs = answeredMs * WAIT_FORGIVENESS;
    waiting.update(WAITED, HALF_COUNTDOWN_MS + answeredMs);
    expect(waiting.voteAfterMs(TOKEN, HALF_COUNTDOWN_MS + answeredMs)).toBe(HALF_COUNTDOWN_MS + forgivenMs);
  });

  it('gives a member that answered long enough its whole countdown again', () => {
    const waiting = new Waiting();
    waiting.update(WAITED, 0);
    waiting.update([], HALF_COUNTDOWN_MS);
    const forgivenAt = HALF_COUNTDOWN_MS + HALF_COUNTDOWN_MS / WAIT_FORGIVENESS;
    waiting.update([], forgivenAt);
    waiting.update(WAITED, forgivenAt + 1);
    expect(waiting.voteAfterMs(TOKEN, forgivenAt + 1)).toBe(KICK_COUNTDOWN_MS);
  });

  it('counts down without a rise for as long as one wait lasts', () => {
    const waiting = new Waiting();
    waiting.update(WAITED, 0);
    waiting.update([], HALF_COUNTDOWN_MS);
    const back = HALF_COUNTDOWN_MS + TICK_MS;
    waiting.update(WAITED, back);
    let previous = waiting.voteAfterMs(TOKEN, back);
    for (let now = back; now <= back + KICK_COUNTDOWN_MS; now += TICK_MS) {
      waiting.update(WAITED, now);
      const left = waiting.voteAfterMs(TOKEN, now);
      expect(left).toBeLessThanOrEqual(previous);
      previous = left;
    }
    expect(previous).toBe(0);
  });
});

describe('a member that keeps the room held in short waits', () => {
  /** Ania answers every ping and frame at once; Bartek's link delivers in bursts every 6 s. The run
   *  ends when Ania's yes kicks Bartek, at the first poll his vote is open. */
  function flap(): { readonly kickedAtMs: number | null; readonly lowestVoteAfterMs: number } {
    const s = startedRoom();
    const acked = new Map<Peer, number>([
      [s.a, 0],
      [s.b, 0],
    ]);
    const answer = (peer: Peer) => {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
      const top = peer.last('frame')?.tick ?? 0;
      for (let tick = (acked.get(peer) ?? 0) + 1; tick <= top; tick++)
        peer.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: LOAD });
      acked.set(peer, top);
    };
    let lowestVoteAfterMs = KICK_COUNTDOWN_MS;
    for (let ms = TICK_MS; ms <= FLAP_RUN_MS; ms += TICK_MS) {
      s.advance(TICK_MS);
      answer(s.a);
      const wait = s.a.last('waiting')?.for.find((member) => member.nick === 'Bartek');
      if (wait !== undefined) {
        lowestVoteAfterMs = Math.min(lowestVoteAfterMs, wait.voteAfterMs);
        if (wait.voteAfterMs === 0) {
          s.a.send({ kind: 'kick', player: 1, yes: true });
          if (s.a.last('kicked') !== undefined) return { kickedAtMs: ms, lowestVoteAfterMs };
        }
      }
      if (Math.floor(ms / BURST_EVERY_MS) !== Math.floor((ms - TICK_MS) / BURST_EVERY_MS)) answer(s.b);
    }
    return { kickedAtMs: null, lowestVoteAfterMs };
  }

  it('reaches a vote the others can pass, though no single wait lasts the countdown', () => {
    const silentShare = (BURST_EVERY_MS - SILENT_AFTER_MS) / BURST_EVERY_MS;
    const owedPerMs = silentShare - (1 - silentShare) * WAIT_FORGIVENESS;
    const { kickedAtMs, lowestVoteAfterMs } = flap();
    expect(lowestVoteAfterMs).toBe(0);
    expect(kickedAtMs).not.toBeNull();
    // A burst's margin either side of the owed time's straight line.
    expect(kickedAtMs).toBeGreaterThan(KICK_COUNTDOWN_MS / owedPerMs - BURST_EVERY_MS * 2);
    expect(kickedAtMs).toBeLessThan(KICK_COUNTDOWN_MS / owedPerMs + BURST_EVERY_MS * 2);
  });
});

describe('the countdown at the start of the clock', () => {
  it('counts no load waited through before the start against a member that drops after it', () => {
    const s = startingRoom();
    for (let ms = 0; ms <= LONG_LOAD_MS; ms += TICK_MS) {
      s.advance(TICK_MS);
      for (const peer of [s.a, s.b]) {
        const ping = peer.last('ping');
        if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
      }
    }
    expect(s.a.last('waiting')?.for).toMatchObject([
      { nick: 'Ania', reason: 'loading' },
      { nick: 'Bartek', reason: 'loading' },
    ]);
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.b.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS);
    s.relay.disconnect(s.b.handle);
    s.advance(TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([
      { nick: 'Bartek', reason: 'gone', voteAfterMs: KICK_COUNTDOWN_MS },
    ]);
  });
});
