import { PROTOCOL_VERSION, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SILENT_AFTER_MS } from '../../src/relay/member.js';
import {
  ackThrough,
  type MessageStage,
  type Peer,
  silentNicks,
  startedRoom,
  TOKEN_C,
} from '../support/message-stage.js';

/** Long enough past the silence limit that a client heard by nothing would be waited for. */
const QUIET_MS = SILENT_AFTER_MS * 2;
const UPLOAD_BYTES_PER_TICK = 4096;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const PING_INTERVAL_MS = 1000;
const FAULTY_TOKEN = 'faulty-token-0123456789';

/** Advance tick by tick; Ania answers every ping, `bartek` runs once per tick with its count. */
function run(s: MessageStage & { a: Peer }, ms: number, bartek: (ticks: number) => void): void {
  for (let ticks = 1; ticks * TICK_MS <= ms; ticks++) {
    s.advance(TICK_MS);
    s.a.send({ kind: 'pong', t: s.a.last('ping')?.t ?? 0 });
    bartek(ticks);
  }
}

describe('hearing from a client', () => {
  it('counts every message, not only pongs', () => {
    const s = startedRoom();
    let acked = 0;
    run(s, QUIET_MS, () => {
      const emitted = s.b.last('frame')?.tick ?? 0;
      if (emitted > acked) ackThrough(s.b, acked + 1, emitted);
      acked = emitted;
    });
    expect(acked).toBeGreaterThan(0);
    expect(silentNicks(s.a)).toEqual([]);
  });

  it('counts progress on a message still arriving', () => {
    const s = startedRoom();
    run(s, QUIET_MS, (ticks) => s.relay.receiving(s.b.handle, ticks * UPLOAD_BYTES_PER_TICK));
    expect(silentNicks(s.a)).toEqual([]);

    s.b.send({ kind: 'blob', type: 'save', to: 'Ania', tick: 1, bytes: 'AAAA' });
    // A transport holding nothing more is not heard from: silence still counts.
    run(s, QUIET_MS, () => s.relay.receiving(s.b.handle, 0));
    expect(silentNicks(s.a)).toEqual(['Bartek']);
  });
});

describe('relay poll faults', () => {
  it('keeps pinging other clients and expiring empty rooms when one connection throws', () => {
    const s = startedRoom();
    const faulty = s.relay.connect({
      send: (message) => {
        if (message.kind === 'ping') throw new Error('socket gone');
      },
      close: () => undefined,
    });
    s.relay.receive(faulty, {
      kind: 'hello',
      protocol: PROTOCOL_VERSION,
      token: FAULTY_TOKEN,
      nick: 'Faulty',
    });
    const healthy = s.introduce(TOKEN_C, 'Cezary');
    s.relay.disconnect(s.a.handle);
    s.relay.disconnect(s.b.handle);
    expect(s.relay.roomCount).toBe(1);
    for (let waited = 0; waited <= EMPTY_ROOM_TTL_MS; waited += PING_INTERVAL_MS) s.advance(PING_INTERVAL_MS);
    expect(healthy.of('ping').length).toBeGreaterThan(0);
    expect(s.relay.roomCount).toBe(0);
  });
});
