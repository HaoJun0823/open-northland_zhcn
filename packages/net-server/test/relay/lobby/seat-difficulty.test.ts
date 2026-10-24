import type { RoomSeatSetup } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SETTINGS, stage, TOKEN_A, TOKEN_B } from '../../support/message-stage.js';

/** A seat a person may take, a free seat the computer plays at a level, and the map's own camp. */
const LEVEL_SEATS: readonly RoomSeatSetup[] = [
  {
    player: 0,
    mode: 'idle',
    claimable: true,
    offers: ['idle', 'computer', 'absent'],
    color: 0,
    difficulty: 'medium',
  },
  {
    player: 1,
    mode: 'computer',
    claimable: true,
    offers: ['idle', 'computer', 'absent'],
    color: 1,
    difficulty: 'medium',
  },
  { player: 2, mode: 'map-ai', claimable: false, offers: ['map-ai'], color: 2 },
];

function lobby(settings = SETTINGS) {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings, seats: LEVEL_SEATS });
  b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
  a.send({ kind: 'claimSeat', player: 0 });
  const seat = (player: number) => b.last('room')?.room.seats.find((view) => view.player === player);
  return { a, b, seat };
}

describe('computer seat levels in the lobby', () => {
  it('refuses scenario seats for both members and the creator without losing their current seat', () => {
    const { a, b, seat } = lobby();
    a.send({ kind: 'setReady', ready: true });
    for (const peer of [a, b]) {
      peer.send({ kind: 'claimSeat', player: 2 });
      expect(peer.last('rejected')?.reason).toEqual({ code: 'seatNotClaimable', player: 2 });
    }
    a.send({ kind: 'moveMember', nick: 'Bartek', player: 2 });
    expect(a.last('rejected')?.reason).toEqual({ code: 'seatNotClaimable', player: 2 });
    expect(seat(0)).toMatchObject({ nick: 'Ania', ready: true });
    expect(seat(2)).toMatchObject({ nick: null, mode: 'map-ai', claimable: false });
    b.send({ kind: 'claimSeat', player: 1 });
    expect(seat(1)).toMatchObject({ nick: 'Bartek', mode: 'human', claimable: true });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')?.session.seats).toContainEqual({ player: 2, mode: 'map-ai', color: 2 });
    a.send({ kind: 'moveMember', nick: 'Bartek', player: 0 });
    expect(a.last('rejected')?.reason).toEqual({ code: 'gameStarted' });
  });

  it('lets the creator set a seat’s level, and refuses it elsewhere', () => {
    const { a, b, seat } = lobby();
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    expect(seat(1)?.difficulty).toBe('easy');
    b.send({ kind: 'setSeat', player: 1, difficulty: 'hard' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'setSeat', player: 2, difficulty: 'hard' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'seatDifficultyUnavailable', player: 2 });
    expect(seat(2)).not.toHaveProperty('difficulty');
  });

  it('carries a level on the start descriptor only for a seat the computer plays', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    b.send({ kind: 'leaveRoom' });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')?.session.seats).toEqual([
      { player: 0, mode: 'human', color: 0 },
      { player: 1, mode: 'computer', color: 1, difficulty: 'easy' },
      { player: 2, mode: 'map-ai', color: 2 },
    ]);
  });

  it('keeps a saved room’s levels', () => {
    const { a } = lobby({ ...SETTINGS, initialSave: { fingerprint: 'a'.repeat(64), tick: 73 } });
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
  });
});

it('keeps map AI exclusive to the reserved seat through lobby changes and start', () => {
  const { a, b, seat } = lobby();
  a.send({ kind: 'setSeat', player: 1, mode: 'map-ai' });
  expect(a.last('rejected')?.reason).toEqual({
    code: 'seatModeUnavailable',
    player: 1,
    mode: 'map-ai',
  });
  expect(seat(1)?.mode).toBe('computer');
  for (const mode of ['computer', 'idle', 'absent']) {
    a.send({ kind: 'setSeat', player: 2, mode });
    expect(a.last('rejected')?.reason).toEqual({ code: 'seatModeUnavailable', player: 2, mode });
  }
  expect(seat(2)).toMatchObject({ mode: 'map-ai', claimable: false, offers: ['map-ai'] });
  b.send({ kind: 'claimSeat', player: 1 });
  b.send({ kind: 'leaveRoom' });
  expect(a.last('room')?.room.seats.find((row) => row.player === 1)?.mode).toBe('computer');
  a.send({ kind: 'setReady', ready: true });
  a.send({ kind: 'start' });
  expect(a.last('start')?.session.seats).toContainEqual({ player: 2, mode: 'map-ai', color: 2 });
});
