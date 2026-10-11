import { expect, it } from 'vitest';
import { createMember } from '../src/relay/member.js';
import { Resync, SNAPSHOT_REFRESH_MS, SNAPSHOT_RETRY_MS } from '../src/relay/resync.js';

it('asks a seated player for snapshots before faster observers, including retries', () => {
  const player = createMember('player', 'Player', 0, { delayTicks: 1, roundTripMs: 100 });
  player.seat = 0;
  player.loaded = true;
  const observers = Array.from({ length: 31 }, (_, index) => {
    const member = createMember(`observer-${index}`, `Observer ${index}`, 0, {
      delayTicks: 1,
      roundTripMs: 1,
    });
    member.loaded = true;
    return member;
  });
  const members = new Map([player, ...observers].map((member) => [member.token, member]));
  const asked: string[] = [];
  const resync = new Resync(
    members,
    (member, message) => {
      if (message.kind === 'snapshotRequest') asked.push(member.nick);
    },
    0,
  );
  resync.advance(SNAPSHOT_REFRESH_MS);
  resync.advance(SNAPSHOT_REFRESH_MS + SNAPSHOT_RETRY_MS);
  expect(asked).toEqual(['Player', 'Player']);
  // Once no seated players remain, the observers can maintain their own session.
  player.seat = null;
  resync.advance(SNAPSHOT_REFRESH_MS + 2 * SNAPSHOT_RETRY_MS);
  expect(asked.at(-1)).toBe('Observer 0');
});
