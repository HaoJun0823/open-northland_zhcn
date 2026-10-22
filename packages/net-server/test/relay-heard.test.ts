import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SILENT_AFTER_MS } from '../src/relay/member.js';
import { ackThrough, type MessageStage, type Peer, startedRoom } from './support/message-stage.js';

/** Long enough past the silence limit that a client heard by nothing would be waited for. */
const QUIET_MS = SILENT_AFTER_MS * 2;
const UPLOAD_BYTES_PER_TICK = 4096;

function silentNicks(peer: Peer): string[] {
  return peer
    .of('waiting')
    .flatMap((notice) =>
      notice.for.filter((member) => member.reason === 'silent').map((member) => member.nick),
    );
}

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

  it('counts progress on a message still arriving, and says how much of it has', () => {
    const s = startedRoom();
    const member = s.b.handle.member;
    if (member === null) throw new Error('Bartek has no member');
    const startedAt = s.now() + TICK_MS;
    let arrived = 0;
    run(s, QUIET_MS, (ticks) => {
      arrived = ticks * UPLOAD_BYTES_PER_TICK;
      s.relay.receiving(s.b.handle, arrived);
    });
    expect(silentNicks(s.a)).toEqual([]);
    expect(member.inboundSince).toBe(startedAt);
    expect(member.inboundBytes).toBe(arrived);

    s.b.send({ kind: 'blob', type: 'save', to: 'Ania', tick: 1, bytes: 'AAAA' });
    expect(member.inboundSince).toBeNull();
    expect(member.inboundBytes).toBe(0);
    // A transport holding nothing more is not heard from: silence still counts.
    run(s, QUIET_MS, () => s.relay.receiving(s.b.handle, 0));
    expect(silentNicks(s.a)).toEqual(['Bartek']);
  });
});
