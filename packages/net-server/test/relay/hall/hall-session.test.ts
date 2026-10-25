import { describe, expect, it } from 'vitest';
import { HALL_CHAT_BURST } from '../../../src/relay/hall/hall.js';
import { HALL_RECORD_VERSION } from '../../../src/relay/hall/record.js';
import { HALL_REFRESH_MS } from '../../../src/relay/relay.js';
import { SEATS, SETTINGS, STAGE_EPOCH_MS, stage, TOKEN_A, TOKEN_B } from '../../support/message-stage.js';

/** A client outside a room hears the rooms, who is online and the server chat; one inside does not. */
describe('relay hall', () => {
  it('shows an arriving client the whole hall, then only what changed', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1);
    expect(a.last('rooms')?.rooms).toEqual([]);
    expect(a.last('presence')?.online).toEqual([{ nick: 'Ania', room: null }]);
    expect(a.last('hallChatHistory')?.lines).toEqual([]);

    const b = s.introduce(TOKEN_B, 'Bartek');
    s.advance(HALL_REFRESH_MS);
    expect(a.last('presence')?.online.map((player) => player.nick)).toEqual(['Ania', 'Bartek']);
    const heard = a.sent.length;
    s.advance(HALL_REFRESH_MS);
    expect(a.sent.length).toBe(heard);

    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    s.advance(HALL_REFRESH_MS);
    expect(a.last('rooms')?.rooms).toMatchObject([
      { name: 'Zatoka', state: 'lobby', members: ['Bartek'], world: SETTINGS.world, playedMs: null },
    ]);
    expect(a.last('presence')?.online).toContainEqual({ nick: 'Bartek', room: b.last('room')?.room.id });
    expect(b.of('presence')).toHaveLength(1);
  });

  it('broadcasts the server chat to the hall alone, and replays it to whoever arrives', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    s.advance(1);
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'hallChat', text: 'ktoś gra?' });
    const line = { from: 'Ania', text: 'ktoś gra?', at: STAGE_EPOCH_MS + 1 };
    expect(a.last('hallChat')).toEqual({ kind: 'hallChat', ...line });
    expect(b.of('hallChat')).toEqual([]);

    b.send({ kind: 'hallChat', text: 'ja' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'alreadyInRoom' });
    b.send({ kind: 'leaveRoom' });
    s.advance(1);
    expect(b.last('hallChatHistory')?.lines).toEqual([line]);
  });

  it('refuses a flood of server chat lines', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1);
    for (let i = 0; i <= HALL_CHAT_BURST; i++) a.send({ kind: 'hallChat', text: `${i}` });
    expect(a.of('hallChat')).toHaveLength(HALL_CHAT_BURST);
    expect(a.last('rejected')).toEqual({
      kind: 'rejected',
      of: 'hallChat',
      reason: { code: 'retryTooSoon' },
    });
  });

  it('remembers who left, and starts from the hall the host kept', () => {
    let changes = 0;
    const kept = {
      version: HALL_RECORD_VERSION,
      chat: [{ from: 'Celina', text: 'dobranoc', at: STAGE_EPOCH_MS - 1000 }],
      seen: [{ nick: 'Celina', at: STAGE_EPOCH_MS - 1000 }],
    } as const;
    const s = stage(true, undefined, { hall: kept, hallChanged: () => changes++ });
    const b = s.introduce(TOKEN_B, 'Bartek');
    s.relay.disconnect(b.handle);
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1);
    expect(changes).toBe(3);
    expect(a.last('hallChatHistory')?.lines).toEqual(kept.chat);
    expect(a.last('presence')?.recent).toEqual([
      { nick: 'Bartek', at: STAGE_EPOCH_MS },
      { nick: 'Celina', at: STAGE_EPOCH_MS - 1000 },
    ]);
    expect(s.relay.hallRecord().seen.map((player) => player.nick)).toEqual(['Celina', 'Bartek', 'Ania']);
  });
});
