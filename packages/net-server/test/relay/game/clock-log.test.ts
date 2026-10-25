import type { GovernedClock } from '@open-northland/net-protocol';
import { CATCH_UP_SHARE } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import { ClockLog, type ClockState, GOVERNED_GAP_MS } from '../../../src/relay/game/clock-log.js';
import { createMember } from '../../../src/relay/member.js';

const TOKEN = 'token-b-0123456789ab';
const PACED: GovernedClock = { nick: 'Bartek', speed: CATCH_UP_SHARE, cause: 'lag' };
const RUNNING: ClockState = { tick: 0, speed: 1, paused: false, pausedBy: null, waited: [], governed: null };
/** Stretches of the clock, in milliseconds. */
const PACED_MS = 6000;
const PAUSED_MS = 4000;
const RELEASED_MS = 1000;
const HOLD_MS = GOVERNED_GAP_MS + 10_000;
const PACED_AGAIN_MS = 2000;

describe('clock log', () => {
  it('counts governed time only while the clock runs, and only running time towards the gap', () => {
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    const member = createMember(TOKEN, 'Bartek', 0, { delayTicks: 1, roundTripMs: 0 });
    const clockLog = new ClockLog(
      new Map([[TOKEN, member]]),
      (event, fields = {}) => lines.push({ event, fields }),
      0,
    );
    let now = 0;
    const step = (ms: number, state: ClockState): void => {
      clockLog.observe(state, now);
      now += ms;
    };
    step(PACED_MS, { ...RUNNING, governed: PACED });
    step(PAUSED_MS, { ...RUNNING, governed: PACED, paused: true, pausedBy: 'Ania' });
    step(PACED_MS, { ...RUNNING, governed: PACED });
    step(RELEASED_MS, RUNNING);
    // A hold longer than the gap: the clock did not run, so pacing again continues the episode.
    step(HOLD_MS, { ...RUNNING, waited: [{ token: TOKEN, nick: 'Bartek', reason: 'gone' }] });
    step(PACED_AGAIN_MS, { ...RUNNING, governed: PACED });
    step(GOVERNED_GAP_MS, RUNNING);
    expect(lines.map((line) => line.event)).toEqual(['held']);
    clockLog.observe(RUNNING, now);

    const governedMs = 2 * PACED_MS + PACED_AGAIN_MS;
    expect(lines.at(-1)).toEqual({
      event: 'governed',
      fields: expect.objectContaining({
        ms: governedMs,
        runs: 2,
        for: [{ nick: 'Bartek', lagMs: governedMs }],
      }),
    });
    expect(clockLog.takeTotals(now)).toMatchObject({ governedMs, pausedMs: PAUSED_MS, heldMs: HOLD_MS });
    expect(member.figures.governedMs).toBe(governedMs);
  });
});
