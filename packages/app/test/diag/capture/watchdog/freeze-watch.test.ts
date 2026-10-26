import { describe, expect, it } from 'vitest';
import type { CaptureContext } from '../../../../src/diag/capture/context.js';
import { FreezeWatch } from '../../../../src/diag/capture/watchdog/freeze-watch.js';

const BEAT_MS = 1000;
const THRESHOLD_MS = 8000;

const IN_GAME: CaptureContext = {
  entry: 'map',
  search: '?map=x',
  worldId: 'x',
  tick: 120,
  inGame: true,
  booting: false,
};
const LATER: CaptureContext = { ...IN_GAME, tick: 121 };

/** A watch whose watchdog checks every second from `fromMs` to `toMs`, the page silent meanwhile. */
function watched(): { watch: FreezeWatch; events: string[]; checkUntil(fromMs: number, toMs: number): void } {
  const events: string[] = [];
  const watch = new FreezeWatch(
    {
      frozen: (silentMs, context) => events.push(`frozen ${silentMs} at tick ${context?.tick}`),
      thawed: (freezeMs, context) => events.push(`thawed ${freezeMs} at tick ${context?.tick}`),
    },
    THRESHOLD_MS,
    BEAT_MS,
    0,
  );
  return {
    watch,
    events,
    checkUntil: (fromMs, toMs) => {
      for (let nowMs = fromMs; nowMs <= toMs; nowMs += BEAT_MS) watch.check(nowMs);
    },
  };
}

describe('FreezeWatch', () => {
  it('reports a visible page silent past the threshold once, then the whole freeze when it beats', () => {
    const { watch, events, checkUntil } = watched();
    watch.beat(0, true, IN_GAME);
    checkUntil(BEAT_MS, 12_000);
    watch.beat(12_500, true, LATER);
    expect(events).toEqual(['frozen 9000 at tick 120', 'thawed 12500 at tick 120']);
  });

  it('counts no silence after a beat that said the page was hidden', () => {
    const { watch, events, checkUntil } = watched();
    watch.beat(0, false, IN_GAME);
    checkUntil(BEAT_MS, 60_000);
    watch.beat(60_500, true, LATER);
    checkUntil(61_000, 65_000);
    expect(events).toEqual([]);
  });

  it('charges no silence to the page while the watchdog itself was not running', () => {
    const { watch, events, checkUntil } = watched();
    watch.beat(0, true, IN_GAME);
    checkUntil(BEAT_MS, 2000);
    // The machine slept: the next check comes a minute late, and the page beats right after it.
    checkUntil(62_000, 64_000);
    watch.beat(64_500, true, LATER);
    expect(events).toEqual([]);
  });
});
