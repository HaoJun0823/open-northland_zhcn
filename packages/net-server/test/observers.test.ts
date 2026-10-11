import { TICK_MS } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import {
  digest,
  LOAD,
  SEATS,
  SETTINGS,
  seatCommand,
  stage,
  startedRoom,
  startingRoom,
  TOKEN_A,
  TOKEN_B,
} from './support/message-stage.js';

it('admits more observers than map seats and starts without waiting for their readiness or loading', () => {
  const s = stage();
  const player = s.introduce(TOKEN_A, 'Player');
  player.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  const roomId = player.last('room')?.room.id;
  const observers = Array.from({ length: 20 }, (_, i) => {
    const observer = s.introduce(`observer-token-000000${i}`, `Observer${i}`);
    observer.send({ kind: 'joinRoom', roomId });
    return observer;
  });
  expect(player.last('room')?.room.members).toHaveLength(21);
  player.send({ kind: 'claimSeat', player: 0 });
  player.send({ kind: 'setReady', ready: true });
  player.send({ kind: 'start' });
  for (const observer of observers) {
    expect(observer.last('start')?.session.localSeat).toBe('observer');
    expect(observer.last('start')?.session.seats).toEqual(player.last('start')?.session.seats);
  }
  player.send({ kind: 'loaded', tick: 0, world: 0 });
  s.advance(TICK_MS);
  expect(player.last('frame')?.tick).toBe(1);
  const observer = observers[0];
  observer?.send(seatCommand(0));
  expect(observer?.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  observer?.send({ kind: 'clock', paused: true });
  expect(observer?.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  observer?.send({ kind: 'responsiveness', mode: 'smooth' });
  expect(observer?.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  observer?.send({ kind: 'kick', player: 0, yes: true });
  expect(observer?.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  player.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  player.send({ kind: 'finish', tick: 1, world: 0, hash: '12345678' });
  expect(player.last('ended')?.tick).toBe(1);
});

it('releases a running seat into read-only observation and retains that role on reconnect', () => {
  const s = startedRoom();
  s.b.send({ kind: 'claimSeat', player: null });
  expect(s.a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.seat).toBeNull();
  expect(s.a.last('room')?.room.seats.find((seat) => seat.player === 1)).toMatchObject({
    nick: null,
    mode: 'idle',
  });
  s.b.send(seatCommand(1));
  expect(s.b.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  s.relay.disconnect(s.b.handle);
  s.advance(TICK_MS);
  expect(s.a.last('frame')?.tick).toBe(1);
  const returning = s.introduce(TOKEN_B, 'Bartek');
  expect(returning.last('start')?.session.localSeat).toBe('observer');
  returning.send({ kind: 'claimSeat', player: 1 });
  expect(returning.last('rejected')?.reason).toEqual({ code: 'gameStarted' });
});

it('starts when the last loading player becomes an observer', () => {
  const s = startingRoom();
  s.a.send({ kind: 'loaded', tick: 0, world: 0 });
  s.b.send({ kind: 'claimSeat', player: null });
  s.advance(TICK_MS);
  expect(s.a.last('frame')?.tick).toBe(1);
});

it('discards a former player’s pending digest before judging the remaining player', () => {
  const s = startedRoom();
  s.advance(TICK_MS);
  s.a.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  s.a.send({ kind: 'claimSeat', player: null });
  s.b.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(2) });
  expect(s.b.last('desync')).toBeUndefined();
  expect(s.b.last('snapshotRequest')).toBeUndefined();
});

it('retains a finish report when its author becomes an observer before the last player does', () => {
  const s = startedRoom();
  s.advance(TICK_MS);
  s.a.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  s.b.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  s.a.send({ kind: 'finish', tick: 1, world: 0, hash: '12345678' });
  s.a.send({ kind: 'claimSeat', player: null });
  s.b.send({ kind: 'claimSeat', player: null });
  s.b.send({ kind: 'finish', tick: 1, world: 0, hash: '12345678' });
  expect(s.a.last('ended')?.tick).toBe(1);
  expect(s.b.last('ended')?.tick).toBe(1);
});

it('keeps observer reports nonauthoritative while the remaining player reconnects', () => {
  const s = startedRoom();
  s.b.send({ kind: 'claimSeat', player: null });
  s.advance(TICK_MS);
  s.relay.disconnect(s.a.handle);
  s.b.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(2) });
  const returning = s.introduce(TOKEN_A, 'Ania');
  returning.send({ kind: 'loaded', tick: 0, world: 0 });
  returning.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  expect(returning.last('desync')).toBeUndefined();
  expect(s.b.last('desync')).toBeDefined();
  expect(s.b.last('snapshotRequest')).toBeUndefined();
});

it('refuses an unsolicited observer snapshot while a seated player remains', () => {
  const s = startedRoom();
  s.b.send({ kind: 'claimSeat', player: null });
  s.advance(TICK_MS);
  s.b.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, world: 0, bytes: 'YQ==' });
  expect(s.b.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  s.relay.disconnect(s.a.handle);
  const returning = s.introduce(TOKEN_A, 'Ania');
  returning.send({ kind: 'loaded', tick: null });
  expect(returning.last('blob')).toBeUndefined();
  expect(returning.last('rejected')?.reason).toEqual({ code: 'noSnapshot' });
});
