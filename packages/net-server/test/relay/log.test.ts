import { TICK_MS } from '@open-northland/net-protocol';
import { STATUS_LOG_INTERVAL_MS } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import {
  ackThrough,
  digest,
  LOAD,
  SEATS,
  SETTINGS,
  stage,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../support/message-stage.js';

/** The diagnostic lines an operator reads to see who plays, in which room, and for how long. */

const SECOND_MS = 1000;

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
