import { TICK_MS, type WaitedMember } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SILENT_AFTER_MS } from '../src/index.js';
import { type MessageStage, type Peer, roomOfThreeStarting } from './support/message-stage.js';

/** The clock and waited-set notices each member hears as the last world of a room of three loads. */

/** Polls after the start that must add no notice. */
const QUIET_POLLS = 10;
const LOADED = { kind: 'loaded', tick: 0, world: 0 } as const;

/** Move the clock with every peer answering its pings, so none is silent. */
function heard(s: MessageStage, peers: readonly Peer[], ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    for (const peer of peers) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
    }
  }
}

/** The clock, or one waited set, in the order a member heard them. */
type StartNotice = 'clock' | readonly WaitedMember[];

const startNotices = (peer: Peer, from: number): StartNotice[] =>
  peer.sent
    .slice(from)
    .flatMap((message): StartNotice[] =>
      message.kind === 'clock' ? ['clock'] : message.kind === 'waiting' ? [message.for] : [],
    );

describe('the notices at the start of a room of three', () => {
  it('sends every member the clock and then one waited set, empty, and nothing more', () => {
    const s = roomOfThreeStarting();
    const peers = [s.a, s.b, s.c];
    heard(s, peers, SILENT_AFTER_MS);
    s.a.send(LOADED);
    s.b.send(LOADED);
    heard(s, peers, SILENT_AFTER_MS);
    expect(s.a.last('waiting')?.for.map(({ nick, reason }) => ({ nick, reason }))).toEqual([
      { nick: 'Cezary', reason: 'loading' },
    ]);
    const from = peers.map((peer) => peer.sent.length);
    s.c.send(LOADED);
    heard(s, peers, TICK_MS * QUIET_POLLS);
    expect(peers.map((peer, i) => startNotices(peer, from[i] ?? 0))).toEqual([
      ['clock', []],
      ['clock', []],
      ['clock', []],
    ]);
  });

  it('never names a member that has just loaded as still loading', () => {
    const s = roomOfThreeStarting();
    const peers = [s.a, s.b, s.c];
    heard(s, peers, SILENT_AFTER_MS);
    const from = peers.map((peer) => peer.sent.length);
    s.a.send(LOADED);
    heard(s, peers, TICK_MS * QUIET_POLLS);
    const waitedNicks = (peer: Peer, start: number) =>
      startNotices(peer, start).map((notice) =>
        notice === 'clock' ? notice : notice.map(({ nick, reason }) => `${nick} ${reason}`),
      );
    expect(peers.map((peer, i) => waitedNicks(peer, from[i] ?? 0))).toEqual([
      [['Bartek loading', 'Cezary loading']],
      [['Bartek loading', 'Cezary loading']],
      [['Bartek loading', 'Cezary loading']],
    ]);
  });
});
