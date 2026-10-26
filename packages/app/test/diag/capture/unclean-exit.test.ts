import { describe, expect, it } from 'vitest';
import type { SessionMarker } from '../../../src/diag/capture/session-marker.js';
import {
  judgeMarker,
  MARKER_STALE_MS,
  type MarkerFacts,
  type MarkerVerdict,
} from '../../../src/diag/capture/unclean-exit.js';

const STARTED_AT = 1_000_000;
const BEAT_AT = 2_000_000;
const LONG_AFTER = BEAT_AT + 10 * MARKER_STALE_MS;
const JUST_AFTER = BEAT_AT + 1000;

const marker: SessionMarker = {
  id: 'a'.repeat(32),
  startedAt: STARTED_AT,
  beatAt: BEAT_AT,
  visible: true,
  context: { entry: 'map', search: '?map=x', worldId: 'x', tick: 500, inGame: true, booting: false },
};

const facts = (over: Partial<MarkerFacts> = {}): MarkerFacts => ({
  nowMs: LONG_AFTER,
  previous: null,
  desktopFaults: [],
  freezeId: null,
  ...over,
});

const kind = (verdict: MarkerVerdict): string => verdict.kind;

describe('judgeMarker', () => {
  it('reports a game page last seen visible that left its marker behind', () => {
    expect(judgeMarker(marker, facts())).toEqual({ kind: 'unclean-exit' });
  });

  it('keeps quiet about a page last seen hidden, in the menu, or discarded by the browser', () => {
    const verdicts = [
      judgeMarker({ ...marker, visible: false }, facts()),
      judgeMarker({ ...marker, context: { ...marker.context, inGame: false, entry: 'menu' } }, facts()),
      judgeMarker(marker, facts({ previous: { id: marker.id, discarded: true } })),
    ].map(kind);
    expect(verdicts).toEqual(['quiet', 'quiet', 'quiet']);
  });

  it('leaves a recently beating marker to its tab, unless this page reloaded that one', () => {
    expect(kind(judgeMarker(marker, facts({ nowMs: JUST_AFTER })))).toBe('live');
    expect(
      kind(judgeMarker(marker, facts({ nowMs: JUST_AFTER, previous: { id: marker.id, discarded: false } }))),
    ).toBe('unclean-exit');
  });

  it("prefers the desktop shell's faults of that page's lifetime, then the watchdog's freeze record", () => {
    const during = { id: 'd'.repeat(32), atMs: BEAT_AT + 500 };
    const before = { id: 'e'.repeat(32), atMs: STARTED_AT - 1 };
    const freezeId = 'f'.repeat(32);
    // Fresh as the shell's reload after a crash leaves it, and frozen before that.
    expect(
      judgeMarker(marker, facts({ nowMs: JUST_AFTER, desktopFaults: [during, before], freezeId })),
    ).toEqual({
      kind: 'desktop',
      faultIds: [during.id],
    });
    expect(
      judgeMarker({ ...marker, context: { ...marker.context, inGame: false } }, facts({ freezeId })),
    ).toEqual({
      kind: 'freeze',
      freezeId,
    });
  });
});
