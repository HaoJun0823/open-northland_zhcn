import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import type { Member } from '../../../src/relay/member.js';
import { SILENT_AFTER_MS } from '../../../src/relay/member.js';
import { SNAPSHOT_RETRY_MS } from '../../../src/relay/snapshots/resync.js';
import { ackThrough, type Peer, roomOfThree } from '../../support/message-stage.js';

const SLOW_LINK_MS = 200;
const FAST_LINK_MS = 20;
const PING_STEP_MS = 1000;

function memberOf(peer: Peer): Member {
  const member = peer.handle.member;
  if (member === null) throw new Error('the peer has no member');
  return member;
}

/** Three players, Bartek on the best link, Cezary diverged at tick 1 and waiting for a snapshot;
 *  Bartek, when asked to, has said nothing since his acknowledgement for long enough to be silent. */
function cezaryWaiting(bartekSilentFirst = false) {
  const s = roomOfThree();
  s.advance(TICK_MS * 3);
  ackThrough(s.b, 1, 1);
  if (bartekSilentFirst) {
    for (let at = 0; at <= SILENT_AFTER_MS; at += PING_STEP_MS) {
      s.advance(PING_STEP_MS);
      for (const peer of [s.a, s.c]) peer.send({ kind: 'pong', t: peer.last('ping')?.t ?? 0 });
    }
  }
  memberOf(s.a).roundTripMs = SLOW_LINK_MS;
  memberOf(s.b).roundTripMs = FAST_LINK_MS;
  memberOf(s.c).roundTripMs = SLOW_LINK_MS;
  ackThrough(s.a, 1, 1);
  ackThrough(s.c, 1, 1, 2);
  return s;
}

describe('snapshot donors', () => {
  it('asks the next donor at once when the asked one diverges', () => {
    const s = cezaryWaiting();
    expect(s.c.of('desync')).toHaveLength(1);
    expect(s.b.of('snapshotRequest')).toHaveLength(1);
    expect(s.a.of('snapshotRequest')).toHaveLength(0);
    // Ania and Bartek tie at tick 2; the earlier connection is the reference, so Bartek diverges.
    ackThrough(s.a, 2, 2);
    ackThrough(s.b, 2, 2, 3);
    expect(s.b.of('desync')).toHaveLength(1);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
  });

  it('asks the next donor once the asked one goes silent, before the retry', () => {
    const s = cezaryWaiting();
    expect(s.b.of('snapshotRequest')).toHaveLength(1);
    for (
      let at = PING_STEP_MS;
      at < SNAPSHOT_RETRY_MS && s.a.of('snapshotRequest').length === 0;
      at += PING_STEP_MS
    ) {
      s.advance(PING_STEP_MS);
      s.a.send({ kind: 'pong', t: s.a.last('ping')?.t ?? 0 });
    }
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    expect(s.now()).toBeLessThan(TICK_MS * 3 + SNAPSHOT_RETRY_MS);
    expect(s.now()).toBeGreaterThan(TICK_MS * 3 + SILENT_AFTER_MS);
  });

  it('passes over a silent member when choosing a donor', () => {
    const s = cezaryWaiting(true);
    expect(s.c.of('desync')).toHaveLength(1);
    expect(s.b.of('snapshotRequest')).toHaveLength(0);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
  });
});
