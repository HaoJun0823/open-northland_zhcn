import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_RESTORE_GRACE_MS } from '../../src/diag/gpu-context.js';
import { DiagLog, logGpuContextLoss } from '../../src/diag/index.js';
import type { Problem } from '../../src/diag/report/problem.js';

const LOST_AT_TICK = 50_017;

describe('GPU context loss logging', () => {
  it('records a lost and a restored context with the sim tick', () => {
    const log = new DiagLog({ consoleLevel: 'silent' });
    const canvas = new EventTarget();
    logGpuContextLoss(canvas, () => LOST_AT_TICK, new AbortController().signal, log);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(
      log.entries().map(({ channel, level, message, data }) => ({ channel, level, message, data })),
    ).toEqual([
      { channel: 'gpu', level: 'warn', message: 'webgl context lost', data: { tick: LOST_AT_TICK } },
      { channel: 'gpu', level: 'info', message: 'webgl context restored', data: { tick: LOST_AT_TICK } },
    ]);
  });

  it('stops listening once the game view is torn down', () => {
    const log = new DiagLog({ consoleLevel: 'silent' });
    const canvas = new EventTarget();
    const lifetime = new AbortController();
    logGpuContextLoss(canvas, () => 0, lifetime.signal, log);
    lifetime.abort();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(log.entries()).toHaveLength(0);
  });

  it('reports a loss the browser does not restore within the grace, and not one it does', () => {
    vi.useFakeTimers();
    try {
      const problems: Problem[] = [];
      const canvas = new EventTarget();
      logGpuContextLoss(
        canvas,
        () => LOST_AT_TICK,
        new AbortController().signal,
        new DiagLog({ consoleLevel: 'silent' }),
        (problem) => problems.push(problem),
      );
      canvas.dispatchEvent(new Event('webglcontextlost'));
      vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS - 1);
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS);
      expect(problems).toEqual([]);
      canvas.dispatchEvent(new Event('webglcontextlost'));
      vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS);
      expect(problems.map(({ trigger, facts }) => ({ trigger, tick: facts?.tick }))).toEqual([
        { trigger: 'context-lost', tick: LOST_AT_TICK },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
