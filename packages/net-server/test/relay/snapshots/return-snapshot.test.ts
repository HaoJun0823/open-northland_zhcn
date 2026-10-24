import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { RETURN_SNAPSHOT_MAX_TICKS, SNAPSHOT_RETRY_MS } from '../../../src/relay/snapshots/resync.js';
import {
  ackThrough,
  type MessageStage,
  type Peer,
  roomOfThree,
  startedRoom,
  TOKEN_B,
  TOKEN_C,
} from '../../support/message-stage.js';

const CACHED = Buffer.from('the cached snapshot').toString('base64');
const FRESH = Buffer.from('a fresh snapshot').toString('base64');
/** Ticks past the replay bound a cache is left behind by. */
const MARGIN_TICKS = 12;
/** Wall time of play past the cache that leaves it further behind the clock than a return replays. */
const PAST_BOUND_MS = (RETURN_SNAPSHOT_MAX_TICKS + MARGIN_TICKS) * TICK_MS;
/** Wall time of play past the cache well within what a return replays. */
const WITHIN_BOUND_MS = (RETURN_SNAPSHOT_MAX_TICKS / 2) * TICK_MS;
/** Ticks the clock would emit while it holds for the returning member, were it not held. */
const HELD_TICKS = 10;

const acked = new WeakMap<Peer, number>();

/** Move the clock with every peer answering its pings and acknowledging each frame. */
function play(s: MessageStage, peers: readonly Peer[], ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    for (const peer of peers) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
      const tick = peer.last('frame')?.tick ?? 0;
      const from = (acked.get(peer) ?? 0) + 1;
      if (tick >= from) ackThrough(peer, from, tick, 1, peer.last('blob')?.tick ?? 0);
      acked.set(peer, tick);
    }
  }
}

function upload(peer: Peer, bytes: string): number {
  const tick = peer.last('frame')?.tick ?? 0;
  peer.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick, bytes });
  return tick;
}

/** `token`'s connection replaced by a reloaded page, which holds no world and asks for one. */
function reload(s: MessageStage, gone: Peer, token: string, nick: string): Peer {
  s.relay.disconnect(gone.handle);
  const back = s.introduce(token, nick);
  back.send({ kind: 'loaded', tick: null });
  return back;
}

function cachedRoom(sincePlayMs: number) {
  const s = startedRoom();
  play(s, [s.a, s.b], TICK_MS * 2);
  const cachedTick = upload(s.a, CACHED);
  play(s, [s.a, s.b], sincePlayMs);
  return { ...s, cachedTick };
}

describe('a member returning without a world', () => {
  it('takes a fresh snapshot instead of a cache further behind than it replays', () => {
    const s = cachedRoom(PAST_BOUND_MS);
    const requests = s.a.of('snapshotRequest').length;
    const back = reload(s, s.b, TOKEN_B, 'Bartek');
    expect(back.of('blob')).toEqual([]);
    expect(s.a.of('snapshotRequest')).toHaveLength(requests + 1);
    // The clock holds for the member while the donor answers, as for any member loading.
    const heldAt = s.a.last('frame')?.tick ?? 0;
    play(s, [s.a], TICK_MS * HELD_TICKS);
    expect(s.a.last('frame')?.tick).toBe(heldAt);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'loading' }]);

    const freshTick = upload(s.a, FRESH);
    expect(freshTick - s.cachedTick).toBeGreaterThan(RETURN_SNAPSHOT_MAX_TICKS);
    expect(back.last('blob')).toMatchObject({ tick: freshTick, bytes: FRESH });
    expect(back.of('frame').filter(({ tick }) => tick > freshTick)).toEqual([]);
    expect(back.of('rejected')).toEqual([]);
  });

  it('asks one donor once for members returning together', () => {
    const s = roomOfThree();
    play(s, [s.a, s.b, s.c], TICK_MS * 2);
    upload(s.a, CACHED);
    play(s, [s.a, s.b, s.c], PAST_BOUND_MS);
    const requests = s.a.of('snapshotRequest').length;
    const bartek = reload(s, s.b, TOKEN_B, 'Bartek');
    const cezary = reload(s, s.c, TOKEN_C, 'Cezary');
    expect(s.a.of('snapshotRequest')).toHaveLength(requests + 1);
    const freshTick = upload(s.a, FRESH);
    for (const back of [bartek, cezary]) {
      expect(back.of('blob')).toHaveLength(1);
      expect(back.last('blob')).toMatchObject({ tick: freshTick, bytes: FRESH });
    }
  });

  it('takes the cache when no donor answers within the retry window', () => {
    const s = cachedRoom(PAST_BOUND_MS);
    const back = reload(s, s.b, TOKEN_B, 'Bartek');
    play(s, [s.a], SNAPSHOT_RETRY_MS - TICK_MS * 2);
    expect(back.of('blob')).toEqual([]);
    play(s, [s.a], TICK_MS * 4);
    expect(back.last('blob')).toMatchObject({ tick: s.cachedTick, bytes: CACHED });
  });

  it('takes the cache at once when it trails the clock by no more than a return replays', () => {
    const s = cachedRoom(WITHIN_BOUND_MS);
    const requests = s.a.of('snapshotRequest').length;
    const back = reload(s, s.b, TOKEN_B, 'Bartek');
    expect(back.last('blob')).toMatchObject({ tick: s.cachedTick, bytes: CACHED });
    expect(s.a.of('snapshotRequest')).toHaveLength(requests);
  });

  it('takes the cache once the asked donor drops and nobody else can send one', () => {
    const s = cachedRoom(PAST_BOUND_MS);
    const back = reload(s, s.b, TOKEN_B, 'Bartek');
    expect(back.of('blob')).toEqual([]);
    s.relay.disconnect(s.a.handle);
    s.advance(TICK_MS);
    expect(back.last('blob')).toMatchObject({ tick: s.cachedTick, bytes: CACHED });
  });
});
