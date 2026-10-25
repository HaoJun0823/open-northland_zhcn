import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { BYTES_PER_KIB } from '../../../src/relay/relay-log.js';
import {
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_RETRY_MS,
  SNAPSHOT_UPLOAD_MAX_MS,
} from '../../../src/relay/snapshots/resync.js';
import { ackThrough, type MessageStage, type Peer, roomOfThree } from '../../support/message-stage.js';

/** A donor on a weak uplink: a large map's snapshot at this rate takes longer than the retry window. */
const UPLINK_KIB_PER_SECOND = 120;
const SNAPSHOT_KIB = 2048;
const UPLOAD_MS = (SNAPSHOT_KIB / UPLINK_KIB_PER_SECOND) * 1000;
const BLOB = Buffer.from('opaque snapshot').toString('base64');

const acked = new WeakMap<Peer, number>();

/** Every listed peer answers its last ping and acknowledges each frame it holds. */
function answer(peers: readonly Peer[]): void {
  for (const peer of peers) {
    const ping = peer.last('ping');
    if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
    const tick = peer.last('frame')?.tick ?? 0;
    ackThrough(peer, (acked.get(peer) ?? 0) + 1, tick);
    acked.set(peer, tick);
  }
}

/** Play until the relay asks one member for the periodic refresh; that member is the donor. */
function untilRefreshAsked(s: MessageStage, peers: readonly Peer[]): Peer {
  for (let elapsed = 0; elapsed <= SNAPSHOT_REFRESH_MS + SNAPSHOT_RETRY_MS; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    answer(peers);
    const donor = peers.find((peer) => peer.of('snapshotRequest').length > 0);
    if (donor !== undefined) return donor;
  }
  throw new Error('no refresh was asked for');
}

/** The donor's upload arrives at the uplink's rate for `ms`; its pongs and acks wait behind it while
 *  the others play on. */
function upload(s: MessageStage, donor: Peer, others: readonly Peer[], ms: number): void {
  for (let elapsed = TICK_MS; elapsed <= ms; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    const arrived = Math.round((elapsed / 1000) * UPLINK_KIB_PER_SECOND * BYTES_PER_KIB);
    s.relay.receiving(donor.handle, arrived);
    answer(others);
  }
}

function slowUpload() {
  const s = roomOfThree();
  const peers = [s.a, s.b, s.c];
  const donor = untilRefreshAsked(s, peers);
  const others = peers.filter((peer) => peer !== donor);
  const nick = donor.handle.member?.nick ?? '';
  return { s, donor, others, nick };
}

describe('a snapshot donor on a slow uplink', () => {
  it('keeps the request and does not pace the room while its upload progresses', () => {
    const { s, donor, others, nick } = slowUpload();
    upload(s, donor, others, UPLOAD_MS);
    donor.send({
      kind: 'blob',
      type: 'snapshot',
      world: 0,
      to: null,
      tick: acked.get(donor) ?? 1,
      bytes: BLOB,
    });
    answer([donor]);
    s.advance(TICK_MS);

    for (const other of others) expect(other.of('snapshotRequest')).toHaveLength(0);
    expect(donor.of('rejected')).toHaveLength(0);
    const governedFor = others[0]?.of('clock').filter((clock) => clock.governed?.nick === nick) ?? [];
    expect(governedFor).toHaveLength(0);
  });

  it('asks the next donor once an upload still arriving has taken the cap', () => {
    const { s, donor, others } = slowUpload();
    upload(s, donor, others, SNAPSHOT_UPLOAD_MAX_MS + TICK_MS * 2);
    expect(others.some((other) => other.of('snapshotRequest').length > 0)).toBe(true);
  });
});
