import { TICK_MS } from '@open-northland/net-protocol';
import { SILENT_AFTER_MS, SNAPSHOT_REFRESH_MS, STATUS_LOG_INTERVAL_MS } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import {
  ackThrough,
  digest,
  LOAD,
  type MessageStage,
  type Peer,
  SEATS,
  SETTINGS,
  stage,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../support/message-stage.js';

/** The diagnostic lines an operator reads to see who plays, in which room, and for how long. */

const SECOND_MS = 1000;
/** Long enough without an acknowledgement for a heard member to trail into `slow`. */
const SLOW_SECONDS = 8;
/** RFC 6455: the connection closed without a close frame. */
const ABNORMAL_CLOSURE = 1006;
const SNAPSHOT_BYTES = Buffer.from('opaque snapshot').toString('base64');

function logged() {
  const lines: { event: string; fields: Record<string, unknown> }[] = [];
  const s = stage(true, (event, fields = {}) => lines.push({ event, fields }));
  const events = (name: string) => lines.filter((line) => line.event === name).map((line) => line.fields);
  return { ...s, lines, events };
}

function seatedPair(s: ReturnType<typeof logged>) {
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  const roomId = a.last('room')?.room.id ?? '';
  b.send({ kind: 'joinRoom', roomId });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
  return { a, b, roomId };
}

/** A started room both members of `seatedPair` loaded, its clock running. */
function runningPair(s: ReturnType<typeof logged>) {
  const pair = seatedPair(s);
  pair.a.send({ kind: 'start' });
  for (const peer of [pair.a, pair.b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
  s.advance(TICK_MS);
  return pair;
}

/** `seconds` of play in whole seconds: `answering` answer each ping and acknowledge every frame,
 *  `heard` only answer pings. */
function play(
  s: MessageStage,
  answering: readonly Peer[],
  seconds: number,
  heard: readonly Peer[] = [],
): void {
  for (let second = 0; second < seconds; second++) {
    s.advance(SECOND_MS);
    for (const peer of [...answering, ...heard]) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
    }
    for (const peer of answering) {
      const from = acked.get(peer) ?? 0;
      const tick = peer.last('frame')?.tick ?? 0;
      ackThrough(peer, from + 1, tick);
      acked.set(peer, tick);
    }
  }
}
const acked = new WeakMap<Peer, number>();

describe('relay log', () => {
  it('follows a room from creation through a played match to its drop', () => {
    const s = logged();
    const { a, b, roomId } = seatedPair(s);
    const room = { room: roomId, name: SETTINGS.name };
    expect(s.events('room created')).toEqual([{ ...room, by: 'Ania', world: 'zatoka', seats: SEATS.length }]);
    expect(s.events('room joined')).toEqual([{ ...room, nick: 'Bartek', members: 2 }]);

    s.advance(30 * SECOND_MS);
    a.send({ kind: 'start' });
    expect(s.events('game starting')).toEqual([{ ...room, players: ['Ania', 'Bartek'], lobbySeconds: 30 }]);
    s.advance(20 * SECOND_MS);
    // Answered pings keep both members heard, so the clock does not wait on them as silent.
    for (const peer of [a, b]) peer.send({ kind: 'pong', t: peer.last('ping')?.t ?? 0 });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS);
    expect(s.events('game running')).toEqual([{ ...room, loadSeconds: 20 }]);

    for (const peer of [a, b]) peer.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
    s.advance(60 * SECOND_MS);
    for (const peer of [a, b]) peer.send({ kind: 'finish', tick: 1, world: 0, hash: '12345678' });
    s.advance(TICK_MS);
    expect(s.events('game ended')).toEqual([{ ...room, tick: 1, playedSeconds: 60 }]);

    a.send({ kind: 'leaveRoom' });
    b.send({ kind: 'leaveRoom' });
    expect(s.events('room left').map(({ nick, cause, members }) => ({ nick, cause, members }))).toEqual([
      { nick: 'Ania', cause: 'left', members: 1 },
      { nick: 'Bartek', cause: 'left', members: 0 },
    ]);
    expect(s.lines.slice(-2).map((line) => line.event)).toEqual(['room left', 'room dropped']);
    expect(s.events('room dropped')).toEqual([
      { ...room, state: 'ended', members: 0, ageSeconds: 110, playedSeconds: 60 },
    ]);
  });

  it('notes a player whose socket drops and returns, and where a departed seat went', () => {
    const s = logged();
    const { a, b, roomId } = seatedPair(s);
    a.send({ kind: 'start' });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });

    s.relay.disconnect(b.handle);
    expect(s.events('disconnect').at(-1)).toMatchObject({ nick: 'Bartek', room: roomId });
    expect(s.events('player dropped')).toEqual([
      { room: roomId, name: SETTINGS.name, nick: 'Bartek', connected: 1 },
    ]);
    s.introduce(TOKEN_B, 'Bartek');
    expect(s.events('hello').at(-1)).toEqual({ nick: 'Bartek', rejoined: true, room: roomId });
    expect(s.events('player returned')).toEqual([
      { room: roomId, name: SETTINGS.name, nick: 'Bartek', connected: 2 },
    ]);

    a.send({ kind: 'leaveRoom' });
    expect(s.events('room left')).toEqual([
      {
        room: roomId,
        name: SETTINGS.name,
        nick: 'Ania',
        cause: 'left',
        state: 'running',
        members: 1,
        seatTo: 'idle',
      },
    ]);
  });

  it('names the members a digest vote put out of sync', () => {
    const s = logged();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = a.last('room')?.room.id ?? '';
    for (const peer of [b, c]) peer.send({ kind: 'joinRoom', roomId });
    for (const [player, peer] of [a, b, c].entries()) peer.send({ kind: 'claimSeat', player });
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of [a, b, c]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS);
    ackThrough(a, 1, 1, 1);
    ackThrough(b, 1, 1, 1);
    ackThrough(c, 1, 1, 9);

    expect(s.events('desync')).toEqual([
      {
        room: roomId,
        name: SETTINGS.name,
        tick: 1,
        diverged: ['Cezary'],
        reference: 'Ania',
        domains: ['rng'],
      },
    ]);
  });

  it('notes whom the clock holds for or paces, and why', () => {
    const s = logged();
    const { a, b, roomId } = runningPair(s);
    const room = { room: roomId, name: SETTINGS.name };
    // Bartek answers nothing: silent, and the clock holds for him until he is heard again.
    play(s, [a], SILENT_AFTER_MS / SECOND_MS + 1);
    expect(s.events('waiting').at(-1)).toMatchObject({
      ...room,
      for: [{ nick: 'Bartek', reason: 'silent' }],
    });
    play(s, [a, b], 2);
    expect(s.events('waiting').at(-1)).toMatchObject({ ...room, for: [] });
    // Heard but acknowledging nothing, he trails the clock and the room is paced for him.
    play(s, [a], SLOW_SECONDS, [b]);
    expect(s.events('governed').at(-1)).toMatchObject({ ...room, governed: { nick: 'Bartek' } });
    play(s, [a, b], 2);
    expect(s.events('governed').at(-1)).toMatchObject({ ...room, governed: null });
  });

  it('notes each snapshot request, what it cost the donor, and every link on the cadence', () => {
    const s = logged();
    const { a, b, roomId } = runningPair(s);
    play(s, [a, b], SNAPSHOT_REFRESH_MS / SECOND_MS - 1);
    expect(s.events('snapshot asked')).toEqual([]);
    for (let second = 0; second < 2 && s.events('snapshot asked').length === 0; second++) play(s, [a, b], 1);
    const asked = s.events('snapshot asked');
    expect(asked).toHaveLength(1);
    const donor = asked[0]?.donor === 'Ania' ? a : b;
    play(s, [a, b], 2);
    const tick = donor.last('frame')?.tick ?? 0;
    donor.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick, bytes: SNAPSHOT_BYTES });
    expect(s.events('snapshot cached')).toEqual([
      { room: roomId, name: SETTINGS.name, from: asked[0]?.donor, tick, kib: 0, askedMs: 2 * SECOND_MS },
    ]);

    play(s, [a, b], STATUS_LOG_INTERVAL_MS / SECOND_MS);
    const status = s.events('room status').at(-1);
    expect(status).toMatchObject({ room: roomId, speed: 1, paused: false, governed: null });
    expect(status?.members).toEqual([
      expect.objectContaining({ nick: 'Ania', seat: 0, connected: true, delayTicks: expect.any(Number) }),
      expect.objectContaining({
        nick: 'Bartek',
        roundTripMs: 0,
        behindTicks: expect.any(Number),
        tickMs: LOAD.tickMs,
      }),
    ]);
  });

  it('says how a connection ended', () => {
    const s = logged();
    const first = s.introduce(TOKEN_A, 'Ania');
    s.introduce(TOKEN_A, 'Ania');
    expect(s.events('hello').at(-1)).toEqual({ nick: 'Ania', rejoined: false, replaced: true });
    expect(first.closed()).toBe('replaced');

    const b = s.introduce(TOKEN_B, 'Bartek');
    s.relay.disconnect(b.handle, { code: ABNORMAL_CLOSURE });
    expect(s.events('disconnect').at(-1)).toMatchObject({ nick: 'Bartek', closeCode: ABNORMAL_CLOSURE });
    const stranger = s.peer();
    stranger.send({ kind: 'listRooms' });
    expect(s.events('disconnect').at(-1)).toMatchObject({ nick: '', cause: 'helloFirst' });
  });

  it('counts clients, rooms and players on a cadence, and keeps quiet while idle', () => {
    const s = logged();
    s.advance(STATUS_LOG_INTERVAL_MS);
    expect(s.events('status')).toEqual([]);

    const { a, b } = seatedPair(s);
    s.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'start' });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(STATUS_LOG_INTERVAL_MS);
    expect(s.events('status')).toEqual([
      { clients: 3, rooms: { lobby: 0, running: 1, ended: 0 }, playing: 2 },
    ]);
  });
});
