/**
 * The fold behind the player-facing performance readout: half-second windows of frame samples turned
 * into one reading and a verdict on what holds the game back. Pure and DOM-free so it unit-tests.
 *
 * The verdict is an approximation over what the loop can time: the main thread's work, the sim's own
 * stepping and, where the browser allows a timer query, the GPU's. Time the browser spends outside
 * those (compositing, other tabs, the driver) only shows as an interval none of them fills.
 */
import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { FrameSample } from './frame-stats.js';

export type PerfVerdict =
  /** Frames keep up; the display's refresh rate is the ceiling. */
  | 'display'
  /** Frames keep up; the player's frame-rate limit is the ceiling. */
  | 'cap'
  | 'paused'
  /** The sim cannot step the requested speed in real time. */
  | 'sim'
  /** The main thread's frame work (scene build, HUD, audio) fills the frame. */
  | 'cpu'
  /** The GPU's draw time fills the frame. */
  | 'gpu'
  /** A relayed room runs slower than asked while this machine keeps up: another member or the link. */
  | 'room'
  /** Frames or ticks fall short while nothing measured fills the frame. */
  | 'other';

export interface PerfReading {
  readonly fps: number;
  /** Average frame interval over the window. */
  readonly frameMs: number;
  /** The interval a keeping-up frame takes: the display's refresh or the frame-rate limit. */
  readonly budgetMs: number;
  /** The estimated refresh rate in Hz. */
  readonly displayHz: number;
  readonly verdict: PerfVerdict;
  /** Main-thread scene, HUD and audio work per frame, without the sim. */
  readonly drawMs: number;
  /** The sim's stepping time per tick; null in a window that stepped none. */
  readonly simMsPerTick: number | null;
  /** The share of real time the sim needs to step the requested speed; null without a stepped tick. */
  readonly simLoad: number | null;
  /** GPU time per frame; null where the browser gives no timer or none landed this window. */
  readonly gpuMs: number | null;
  readonly requestedSpeed: number;
  /** Set while a sustained shortfall holds: the speed the clock actually delivers. */
  readonly deliveredSpeed: number | null;
  readonly worstMs: number;
}

export interface PerfReadingContext {
  /** The player's frame-rate limit, null when frames follow the display. */
  readonly capFps: number | null;
  /** The sim steps on this thread, so its time is part of the frame's main-thread work. */
  readonly simOnMainThread: boolean;
  /** A relay runs the clock, so a shortfall may be the room's rather than this machine's. */
  readonly sharedClock: boolean;
}

const WINDOW_MS = 500;
/** The sim needing this share of real time cannot keep the requested speed. Approximation. */
const SIM_SATURATED_LOAD = 0.85;
/** A measured cause filling this share of any frame holds it back, even where the frame rate cannot be
 *  told apart from the refresh (a GPU-bound loop that never once made the refresh). Approximation. */
const SATURATED_SHARE = 0.85;
/** A measured cause filling this share of a slow frame is taken as the one holding it back: the
 *  browser's untimed work on the same thread (layout, paint, collection) grows with it. Approximation. */
const LIKELY_CAUSE_SHARE = 0.5;
/** Frames this much slower than the budget count as falling behind. Approximation leaving room for
 *  rAF jitter around the refresh grid. */
const BEHIND_RATIO = 1.2;
/** No display refreshes faster; bounds the estimate against a burst of early timestamps. */
const MAX_REFRESH_HZ = 360;
const MS_PER_SECOND = 1000;
/** Room for every frame interval of a window at the fastest refresh; a burst beyond it goes unsampled. */
const WINDOW_FRAME_CAPACITY = Math.ceil((WINDOW_MS * MAX_REFRESH_HZ) / MS_PER_SECOND);
/**
 * rAF fires on the display's vsync, so a frame that misses one waits for the next: a slow loop mixes
 * one-refresh and multi-refresh intervals. A low quantile of a window's intervals recovers the refresh
 * where the average cannot, and ignores a single early timestamp. Approximation.
 */
const REFRESH_QUANTILE = 0.1;
/** Windows the refresh estimate remembers, about two seconds: long enough to ride out a window with no
 *  one-refresh frame, short enough to follow the game onto a slower display. */
const REFRESH_MEMORY_WINDOWS = 4;

export class PerfReadingWindow {
  private startedMs = 0;
  private frames = 0;
  private frameMs = 0;
  private mainMs = 0;
  private drawMs = 0;
  private simMs = 0;
  private steps = 0;
  private worstMs = 0;
  private gpuMs = 0;
  private gpuFrames = 0;
  private readonly intervals = new Float64Array(WINDOW_FRAME_CAPACITY);
  /** Each recent window's low-quantile interval, newest last; their minimum is the refresh. */
  private readonly recentRefreshMs: number[] = [];

  constructor(private context: PerfReadingContext) {}

  /** The player changed the frame-rate limit; the window under way is judged by the new one. */
  setCapFps(capFps: number | null): void {
    this.context = { ...this.context, capFps };
  }

  /** One GPU measurement, whichever frame it belongs to: the window averages what landed in it. */
  recordGpu(ms: number): void {
    this.gpuMs += ms;
    this.gpuFrames++;
  }

  /**
   * Fold one frame; returns the window's reading on the frame that closes it, else null.
   * `shortfallSpeed` is the delivered speed while a sustained shortfall holds, else null
   * (`FrameStats.sustainedShortfallSpeed`).
   */
  record(sample: FrameSample, shortfallSpeed: number | null): PerfReading | null {
    if (sample.elapsedMs <= 0) return null;
    this.frames++;
    this.startedMs += sample.elapsedMs;
    this.frameMs += sample.elapsedMs;
    this.mainMs += sample.cpuMs;
    this.drawMs += sample.snapMs + sample.drawMs;
    this.simMs += sample.simMs;
    this.steps += sample.steps;
    this.worstMs = Math.max(this.worstMs, sample.elapsedMs);
    if (this.frames <= WINDOW_FRAME_CAPACITY) this.intervals[this.frames - 1] = sample.elapsedMs;
    if (this.startedMs < WINDOW_MS) return null;
    const reading = this.close(sample, shortfallSpeed);
    this.open();
    return reading;
  }

  /** Folds this window's low-quantile interval into the recent ones and answers their minimum. */
  private learnRefresh(): number {
    const intervals = this.intervals.subarray(0, Math.min(this.frames, WINDOW_FRAME_CAPACITY)).sort();
    const low = intervals[Math.floor(intervals.length * REFRESH_QUANTILE)] ?? this.frameMs / this.frames;
    this.recentRefreshMs.push(Math.max(MS_PER_SECOND / MAX_REFRESH_HZ, low));
    if (this.recentRefreshMs.length > REFRESH_MEMORY_WINDOWS) this.recentRefreshMs.shift();
    return Math.min(...this.recentRefreshMs);
  }

  private open(): void {
    this.startedMs = 0;
    this.frames = 0;
    this.frameMs = 0;
    this.mainMs = 0;
    this.drawMs = 0;
    this.simMs = 0;
    this.steps = 0;
    this.worstMs = 0;
    this.gpuMs = 0;
    this.gpuFrames = 0;
  }

  private close(sample: FrameSample, shortfallSpeed: number | null): PerfReading {
    const frameMs = this.frameMs / this.frames;
    const refreshMs = this.learnRefresh();
    const budgetMs = Math.max(refreshMs, capMsOf(this.context) ?? 0);
    const simMsPerTick = this.steps === 0 ? null : this.simMs / this.steps;
    const ticksPerSecond = TICKS_PER_SECOND * sample.speed;
    const simLoad = simMsPerTick === null ? null : (simMsPerTick * ticksPerSecond) / MS_PER_SECOND;
    const gpuMs = this.gpuFrames === 0 ? null : this.gpuMs / this.gpuFrames;
    const slowed = !sample.paused && shortfallSpeed !== null;
    const loads: VerdictLoads = {
      frameMs,
      budgetMs,
      mainMs: this.mainMs / this.frames,
      drawMs: this.drawMs / this.frames,
      simMs: this.simMs / this.frames,
      simLoad,
      gpuMs,
      slowed,
    };
    return {
      fps: MS_PER_SECOND / frameMs,
      frameMs,
      budgetMs,
      displayHz: MS_PER_SECOND / refreshMs,
      verdict: sample.paused ? 'paused' : perfVerdict(loads, this.context),
      drawMs: loads.drawMs,
      simMsPerTick,
      simLoad,
      gpuMs,
      requestedSpeed: sample.speed,
      deliveredSpeed: slowed ? shortfallSpeed : null,
      worstMs: this.worstMs,
    };
  }
}

export interface VerdictLoads {
  readonly frameMs: number;
  readonly budgetMs: number;
  /** All main-thread work per frame, the sim's included when it steps there. */
  readonly mainMs: number;
  readonly drawMs: number;
  /** The sim's stepping time per frame, on whichever thread it runs. */
  readonly simMs: number;
  readonly simLoad: number | null;
  readonly gpuMs: number | null;
  /** The clock delivers measurably less than the requested speed. */
  readonly slowed: boolean;
}

/** What holds a running game back, from the most specific measured cause to the least. */
export function perfVerdict(loads: VerdictLoads, context: PerfReadingContext): PerfVerdict {
  if (loads.slowed && loads.simLoad !== null && loads.simLoad >= SIM_SATURATED_LOAD) return 'sim';
  const behind = loads.frameMs > loads.budgetMs * BEHIND_RATIO;
  const gpuShare = loads.gpuMs === null ? 0 : loads.gpuMs / loads.frameMs;
  const mainShare = loads.mainMs / loads.frameMs;
  const causeShare = Math.max(gpuShare, mainShare);
  if (causeShare >= SATURATED_SHARE || (behind && causeShare >= LIKELY_CAUSE_SHARE)) {
    if (gpuShare >= mainShare) return 'gpu';
    return context.simOnMainThread && loads.simMs > loads.drawMs ? 'sim' : 'cpu';
  }
  if (behind || loads.slowed) return loads.slowed && context.sharedClock ? 'room' : 'other';
  const capMs = capMsOf(context);
  return capMs !== null && capMs >= loads.budgetMs ? 'cap' : 'display';
}

function capMsOf(context: PerfReadingContext): number | null {
  return context.capFps === null ? null : MS_PER_SECOND / context.capFps;
}
