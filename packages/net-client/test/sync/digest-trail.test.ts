import type { WireDigest } from '@open-northland/net-protocol';
import { SYNC_DOMAINS } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { DigestTrail } from '../../src/sync/digest-trail.js';
import { DISPUTE_WINDOW_TICKS } from '../../src/sync/dispute-capture.js';

it('keeps the digest of every tick a dispute verdict can still name', () => {
  const trail = new DigestTrail();
  const last = DISPUTE_WINDOW_TICKS * 2;
  const digest = Object.fromEntries(SYNC_DOMAINS.map((domain) => [domain, 0])) as WireDigest;
  for (let tick = 1; tick <= last; tick++) trail.record(tick, digest);
  const ticks = trail.list().map((entry) => entry.tick);
  expect(ticks).toHaveLength(DISPUTE_WINDOW_TICKS);
  expect(ticks[0]).toBe(last - DISPUTE_WINDOW_TICKS + 1);
  expect(ticks.at(-1)).toBe(last);
});
