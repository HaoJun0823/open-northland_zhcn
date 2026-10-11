import { describe, expect, it } from 'vitest';
import type { FrameSample } from '../src/diag/frame-stats.js';
import {
  type PerfReading,
  type PerfReadingContext,
  PerfReadingWindow,
  perfVerdict,
  type VerdictLoads,
} from '../src/diag/perf-reading.js';

const REFRESH_60_MS = 1000 / 60;

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    elapsedMs: REFRESH_60_MS,
    tick: 100,
    steps: 1,
    droppedTicks: 0,
    speed: 1,
    paused: false,
    entities: 500,
    drawn: 120,
    pooled: 130,
    cpuMs: 4,
    simMs: 1,
    receiveMs: 0,
    batches: 0,
    leadTicks: 0,
    snapMs: 0.5,
    drawMs: 2.5,
    worldMs: 2,
    ...overrides,
  };
}

const WORKER: PerfReadingContext = { capFps: null, simOnMainThread: false, sharedClock: false };
const INLINE: PerfReadingContext = { ...WORKER, simOnMainThread: true };

/** Feeds identical frames until a window closes. */
function readOnce(
  window: PerfReadingWindow,
  frame: Partial<FrameSample>,
  shortfallSpeed: number | null = null,
): PerfReading {
  for (let i = 0; i < 1000; i++) {
    const reading = window.record(sample(frame), shortfallSpeed);
    if (reading !== null) return reading;
  }
  throw new Error('no window closed');
}

const loads = (overrides: Partial<VerdictLoads>): VerdictLoads => ({
  frameMs: REFRESH_60_MS,
  budgetMs: REFRESH_60_MS,
  mainMs: 4,
  drawMs: 3,
  simMs: 1,
  simLoad: 0.1,
  gpuMs: 3,
  slowed: false,
  ...overrides,
});

describe('PerfReadingWindow', () => {
  it('closes a reading every half second of frames, not every frame', () => {
    const window = new PerfReadingWindow(WORKER);
    let readings = 0;
    for (let i = 0; i < 60; i++) if (window.record(sample(), null) !== null) readings++;
    expect(readings).toBe(2);
  });

  it('recovers the refresh from a game slow from its first frame, missing every other vsync', () => {
    const window = new PerfReadingWindow(WORKER);
    let reading: PerfReading | null = null;
    for (let i = 0; reading === null; i++) {
      reading = window.record(sample({ elapsedMs: i % 2 === 0 ? REFRESH_60_MS : 2 * REFRESH_60_MS }), null);
    }
    expect(Math.round(reading.fps)).toBe(40);
    expect(Math.round(reading.displayHz)).toBe(60);
    expect(reading.verdict).toBe('other');
  });

  it('follows the game onto a slower display within a few windows', () => {
    const window = new PerfReadingWindow(WORKER);
    readOnce(window, { elapsedMs: 1000 / 144 });
    let reading = readOnce(window, {});
    for (let i = 0; i < 4; i++) reading = readOnce(window, {});
    expect(Math.round(reading.displayHz)).toBe(60);
    expect(reading.verdict).toBe('display');
  });

  it('learns the refresh rate from the fastest window and holds it through a slow one', () => {
    const window = new PerfReadingWindow(WORKER);
    expect(Math.round(readOnce(window, {}).displayHz)).toBe(60);
    const slow = readOnce(window, { elapsedMs: 25, cpuMs: 4 });
    expect(Math.round(slow.fps)).toBe(40);
    expect(slow.budgetMs).toBeCloseTo(REFRESH_60_MS);
  });

  it('reads the sim load at the requested speed, per tick stepped', () => {
    const window = new PerfReadingWindow(WORKER);
    // 2 ms a tick at x3 is 36 ticks a second, 72 ms of every 1000.
    const reading = readOnce(window, { simMs: 2, steps: 1, speed: 3 });
    expect(reading.simMsPerTick).toBeCloseTo(2);
    expect(reading.simLoad).toBeCloseTo(0.072);
  });

  it('averages the GPU measurements that landed in the window', () => {
    const window = new PerfReadingWindow(WORKER);
    window.recordGpu(2);
    window.recordGpu(4);
    expect(readOnce(window, {}).gpuMs).toBeCloseTo(3);
    expect(readOnce(window, {}).gpuMs).toBeNull();
  });

  it('shows the delivered speed only while a shortfall holds', () => {
    const window = new PerfReadingWindow(WORKER);
    expect(readOnce(window, { speed: 3 }, 2.4).deliveredSpeed).toBe(2.4);
    expect(readOnce(window, { speed: 3 }).deliveredSpeed).toBeNull();
  });

  it('says paused rather than judging a paused game', () => {
    expect(readOnce(new PerfReadingWindow(WORKER), { paused: true, steps: 0 }).verdict).toBe('paused');
  });

  it('names the frame-rate limit as the ceiling when it is below the display', () => {
    const capped = new PerfReadingWindow({ ...WORKER, capFps: 30 });
    expect(readOnce(capped, { elapsedMs: 1000 / 30 }).verdict).toBe('cap');
  });

  it('judges the next window by a frame-rate limit changed in play', () => {
    const window = new PerfReadingWindow(WORKER);
    expect(readOnce(window, { elapsedMs: 1000 / 30 }).verdict).toBe('display');
    window.setCapFps(30);
    expect(readOnce(window, { elapsedMs: 1000 / 30 }).verdict).toBe('cap');
  });
});

describe('perfVerdict', () => {
  it('names the display as the ceiling while every measured budget has room', () => {
    expect(perfVerdict(loads({}), WORKER)).toBe('display');
  });

  it('keeps a frame that makes its budget with room to spare smooth', () => {
    expect(perfVerdict(loads({ gpuMs: 13 }), WORKER)).toBe('display');
  });

  it('blames a part that fills the frame even when the frame rate passes for the refresh', () => {
    expect(perfVerdict(loads({ frameMs: 25, budgetMs: 25, gpuMs: 23 }), WORKER)).toBe('gpu');
  });

  it('blames the GPU when its draw time fills a slow frame', () => {
    expect(perfVerdict(loads({ frameMs: 25, gpuMs: 22 }), WORKER)).toBe('gpu');
  });

  it('blames the main thread when its work is most of a slow frame, the browser filling the rest', () => {
    expect(perfVerdict(loads({ frameMs: 23, mainMs: 17, drawMs: 16, simMs: 1 }), WORKER)).toBe('cpu');
  });

  it('blames the sim when it steps on the main thread and outweighs the drawing', () => {
    expect(perfVerdict(loads({ frameMs: 30, mainMs: 28, drawMs: 6, simMs: 22 }), INLINE)).toBe('sim');
  });

  it('blames a worker sim that cannot step the requested speed in real time', () => {
    expect(perfVerdict(loads({ slowed: true, simLoad: 1.2 }), WORKER)).toBe('sim');
  });

  it('blames the room when a relayed clock runs slow while this machine keeps up', () => {
    expect(perfVerdict(loads({ slowed: true }), { ...WORKER, sharedClock: true })).toBe('room');
  });

  it('owns up to a slowdown nothing measured explains', () => {
    expect(perfVerdict(loads({ frameMs: 30 }), WORKER)).toBe('other');
    expect(perfVerdict(loads({ slowed: true }), WORKER)).toBe('other');
  });

  it('judges without a GPU timer from the main thread alone', () => {
    expect(perfVerdict(loads({ gpuMs: null }), WORKER)).toBe('display');
  });
});
