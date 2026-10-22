import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B } from './support/message-stage.js';

const bytes = Buffer.from('opaque save').toString('base64');
const identity = { fingerprint: createHash('sha256').update(bytes).digest('hex'), tick: 73 };
function lobby() {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({
    kind: 'createRoom',
    settings: { ...SETTINGS, initialSave: identity, mapOrigin: 'user' },
    seats: SEATS,
  });
  b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  for (const p of [a, b])
    p.send({
      kind: 'setCompatibility',
      compatibility: { ...TEST_COMPATIBILITY, save: identity.fingerprint },
    });
  return { ...s, a, b };
}
const upload = { kind: 'blob', type: 'initialSave', to: null, tick: identity.tick, bytes };
describe('immutable lobby files', () => {
  it('requires the exact creator upload and every save report before readiness', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setReady', ready: true });
    expect(a.last('rejected')?.reason).toEqual({ code: 'initialSaveMissing' });
    b.send(upload);
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ ...upload, bytes: Buffer.from('different').toString('base64') });
    expect(a.last('rejected')?.reason).toEqual({ code: 'initialSaveFingerprintMismatch' });
    a.send(upload);
    b.send({ kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
    a.send({ kind: 'setReady', ready: true });
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'incompatible', nick: 'Bartek', kind: 'save' });
  });
  it('starts at the declared saved tick and serves cached bytes instead of fresh tick zero', () => {
    const { a, b } = lobby();
    a.send(upload);
    for (const p of [a, b]) p.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')).toMatchObject({ snapshotTick: 73, session: { initialSave: identity } });
    a.send({ kind: 'loaded', tick: 0, world: 73 });
    expect(a.last('rejected')?.reason).toEqual({ code: 'worldTickMismatch', tick: 73 });
    b.send({ kind: 'loaded', tick: null, world: 0 });
    expect(b.last('blob')).toMatchObject({ type: 'snapshot', tick: 73, bytes });
  });
  it('retains the pinned initial save after its creator leaves', () => {
    const { a, b } = lobby();
    a.send(upload);
    a.send({ kind: 'leaveRoom' });
    b.send({ kind: 'requestInitialSave' });
    expect(b.last('blob')).toMatchObject({ type: 'initialSave', tick: 73, bytes });
  });
  it('lets the creator resolve vacant saved seats without removing them', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setSeat', player: 2, mode: 'idle' });
    expect(a.last('room')?.room.seats.find((seat) => seat.player === 2)?.mode).toBe('idle');
    b.send({ kind: 'setSeat', player: 2, mode: 'computer' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'setSeat', player: 2, mode: 'computer' });
    expect(a.last('room')?.room.seats.find((seat) => seat.player === 2)?.mode).toBe('computer');
    a.send({ kind: 'setSeat', player: 2, mode: 'absent' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
  });
  it('locks saved overrides and routes map retries to the current creator', () => {
    const { a, b, advance } = lobby();
    a.send({ kind: 'setSeat', player: 2, color: 3 });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
    a.send({ kind: 'setSettings', settings: { ...SETTINGS, seed: 9, world: undefined } });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedRulesFixed' });
    b.send({ kind: 'requestMap' });
    expect(a.last('mapRequest')).toEqual({ kind: 'mapRequest', from: 'Bartek' });
    b.send({ kind: 'requestMap' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'retryTooSoon' });
    expect(a.of('mapRequest')).toHaveLength(1);
    advance(2000);
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toHaveLength(2);
    b.send({ kind: 'blob', type: 'map', tick: null, to: null, bytes });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
  });
});
describe('catalogue maps', () => {
  const catalogMap = { entryId: 'cn-zatoka', mapId: 'zatoka', fingerprint: 'd'.repeat(64), irVersion: 3 };
  it('keeps the announcement through a settings change and relays the creator map as a fallback', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: { ...SETTINGS, mapOrigin: 'catalog', catalogMap }, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'setSettings', settings: { ...SETTINGS, seed: 9, world: undefined } });
    expect(b.last('room')?.room.settings).toMatchObject({ seed: 9, mapOrigin: 'catalog', catalogMap });
    b.send({ kind: 'requestMap' });
    expect(a.last('mapRequest')).toEqual({ kind: 'mapRequest', from: 'Bartek' });
    a.send({ kind: 'blob', type: 'map', tick: null, to: 'Bartek', bytes });
    expect(b.last('blob')).toMatchObject({ type: 'map', from: 'Ania', bytes });
  });
});
describe('the kept map', () => {
  const COOLDOWN_MS = 2000;
  const mapText = (label: string) => Buffer.from(`map ${label}`).toString('base64');
  function mapLobby() {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: { ...SETTINGS, mapOrigin: 'user' }, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    return { ...s, a, b };
  }
  const deliverTo = (nick: string, bytes: string) => ({
    kind: 'blob',
    type: 'map',
    tick: null,
    to: nick,
    bytes,
  });

  it('serves the creator text again and replaces it with the next map the creator sends', () => {
    const { a, b, advance } = mapLobby();
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toHaveLength(1);
    a.send(deliverTo('Bartek', mapText('first')));
    advance(COOLDOWN_MS);
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toHaveLength(1);
    expect(b.last('blob')).toEqual({
      kind: 'blob',
      type: 'map',
      from: 'Ania',
      tick: null,
      bytes: mapText('first'),
    });
    a.send(deliverTo('Bartek', mapText('second')));
    advance(COOLDOWN_MS);
    b.send({ kind: 'requestMap' });
    expect(b.of('blob')).toHaveLength(4);
    expect(b.last('blob')?.bytes).toBe(mapText('second'));
  });

  it('keeps a map the creator deposits for itself without forwarding it, and replaces it with the next', () => {
    const { a, b, advance } = mapLobby();
    a.send(deliverTo('Ania', mapText('first')));
    expect(a.of('rejected')).toEqual([]);
    expect(a.of('blob')).toEqual([]);
    expect(b.of('blob')).toEqual([]);
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toEqual([]);
    expect(b.last('blob')).toEqual({
      kind: 'blob',
      type: 'map',
      from: 'Ania',
      tick: null,
      bytes: mapText('first'),
    });
    a.send(deliverTo('Ania', mapText('second')));
    advance(COOLDOWN_MS);
    b.send({ kind: 'requestMap' });
    expect(b.of('blob')).toHaveLength(2);
    expect(b.last('blob')?.bytes).toBe(mapText('second'));
  });

  it('refuses a deposit from a guest and after the start', () => {
    const { a, b } = mapLobby();
    b.send(deliverTo('Bartek', mapText('guest')));
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    for (const p of [a, b]) {
      p.send({ kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
      p.send({ kind: 'setReady', ready: true });
    }
    a.send({ kind: 'start' });
    expect(a.of('start')).toHaveLength(1);
    a.send(deliverTo('Ania', mapText('late')));
    expect(a.last('rejected')?.reason).toEqual({ code: 'lobbyFilesFixed' });
    b.send({ kind: 'requestMap' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'mapNotKept' });
  });

  it('asks the creator again once it reports another copy of the map, and not a creator it passed to', () => {
    const { a, b, advance } = mapLobby();
    a.send(deliverTo('Bartek', mapText('first')));
    a.send({ kind: 'setCompatibility', compatibility: { ...TEST_COMPATIBILITY, map: 'c'.repeat(64) } });
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toHaveLength(1);
    expect(b.of('blob')).toHaveLength(1);
    advance(COOLDOWN_MS);
    a.send({ kind: 'leaveRoom' });
    b.send({ kind: 'requestMap' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorHasMap' });
  });
});
