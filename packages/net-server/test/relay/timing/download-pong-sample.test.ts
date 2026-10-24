import { describe, expect, it } from 'vitest';
import { type MessageStage, type Peer, startedRoom } from '../../support/message-stage.js';

const LINK_MS = 40;
/** Long enough for the smoothed trip to settle, in pings answered over the steady link. */
const WARM_UP_PINGS = 20;
/** How long a large message to Bartek takes to read: far longer than his link's round trip. */
const DOWNLOAD_MS = 3000;
const FRAGMENTS = 4;

/** Let the next ping to `peer` go out, and return its stamp. */
function nextPing(s: MessageStage, peer: Peer): number {
  const before = peer.of('ping').length;
  while (peer.of('ping').length === before) s.advance(LINK_MS);
  const ping = peer.last('ping');
  if (ping === undefined) throw new Error('no ping');
  return ping.t;
}

function answer(s: MessageStage, peer: Peer, stamp: number, afterMs: number): void {
  s.advance(afterMs);
  peer.send({ kind: 'pong', t: stamp });
}

function warmedUp() {
  const s = startedRoom();
  for (let i = 0; i < WARM_UP_PINGS; i++) answer(s, s.b, nextPing(s, s.b), LINK_MS);
  return s;
}

describe('round trip of a client that is downloading', () => {
  it('takes no sample from a ping that queued behind a multi-fragment message', () => {
    const s = warmedUp();
    const probe = s.b.handle.probe;
    const { samples, ticks } = probe.delay;
    s.relay.sending(s.b.handle, true);
    const queued = nextPing(s, s.b);
    for (let fragment = 0; fragment < FRAGMENTS; fragment++) {
      s.advance(DOWNLOAD_MS / FRAGMENTS);
      s.relay.downloading(s.b.handle);
    }
    s.relay.sending(s.b.handle, false);
    answer(s, s.b, queued, LINK_MS);
    expect(probe.delay.samples).toBe(samples);
    expect(probe.delay.ticks).toBe(ticks);

    answer(s, s.b, nextPing(s, s.b), LINK_MS);
    expect(probe.delay.samples).toBe(samples + 1);
    expect(probe.delay.ticks).toBe(ticks);
  });

  it('samples a ping sent before the download began, which is ahead of it', () => {
    const s = warmedUp();
    const probe = s.b.handle.probe;
    const { samples } = probe.delay;
    const ahead = nextPing(s, s.b);
    s.relay.sending(s.b.handle, true);
    answer(s, s.b, ahead, LINK_MS);
    expect(probe.delay.samples).toBe(samples + 1);
  });

  it('samples a late pong when no multi-fragment message was in flight', () => {
    const s = warmedUp();
    const probe = s.b.handle.probe;
    const { samples, roundTripMs } = probe.delay;
    answer(s, s.b, nextPing(s, s.b), DOWNLOAD_MS);
    expect(probe.delay.samples).toBe(samples + 1);
    expect(probe.delay.roundTripMs).toBeGreaterThan(roundTripMs);
  });
});
