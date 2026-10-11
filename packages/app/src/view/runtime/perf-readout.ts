import { createGpuFrameTimer, type GpuFrameTimer, type GpuSpan } from '@open-northland/render';
import type { Application } from 'pixi.js';
import type { FrameSample } from '../../diag/frame-stats.js';
import { type PerfReading, type PerfReadingContext, PerfReadingWindow } from '../../diag/perf-reading.js';
import { createPerfReadoutView, type PerfReadoutView } from '../../hud/dom/perf-readout.js';

/** The player's frame-rate counter on the top bar, fed once a frame by the frame loop. */
export interface PerfReadout {
  setShown(shown: boolean): void;
  /** The frame-rate limit the verdict measures the frames against; null follows the display. */
  setCapFps(capFps: number | null): void;
  /** The bracket the world renderer times its renders with; undefined while nothing measures them. */
  gpuTimer(): GpuSpan | undefined;
  /** `shortfallSpeed` is the delivered speed while a sustained shortfall holds, else null. */
  record(sample: FrameSample, shortfallSpeed: number | null): void;
  /** The newest half-second reading while the counter shows, else null. */
  lastReading(): PerfReading | null;
  dispose(): void;
}

export interface PerfReadoutDeps {
  readonly app: Application;
  readonly context: PerfReadingContext;
  readonly initiallyShown: boolean;
  /** The WebGL renderer string naming the GPU, null where the browser gives none. */
  readonly adapter: string | null;
  /** The system bar's lead node, which the counter stands in while shown. */
  readonly lead: HTMLElement;
}

/** About two seconds of frames at 60 fps: enough to see a hitch, short enough to read at a glance. */
const GRAPH_FRAMES = 120;

/**
 * Measures whenever the counter shows, so its breakdown opens on a current reading rather than half a
 * second of nothing; the GPU timer costs two GL calls a frame.
 */
export function mountPerfReadout(deps: PerfReadoutDeps): PerfReadout {
  const readings = new PerfReadingWindow(deps.context);
  const frameTimes = new Float64Array(GRAPH_FRAMES);
  const ordered = new Float64Array(GRAPH_FRAMES);
  let newest = 0;
  let shown = false;
  // Built on the first use, so a player who keeps the counter off pays nothing for it.
  let view: PerfReadoutView | null = null;
  let latest: PerfReading | null = null;
  // Built with the view; null where the browser gives no timer.
  let gpu: GpuFrameTimer | null | undefined;
  const takeGpu = (ms: number): void => readings.recordGpu(ms);
  const discardGpu = (): void => {};

  const setShown = (next: boolean): void => {
    shown = next;
    if (!next) {
      latest = null;
      view?.element.remove();
      return;
    }
    view ??= createPerfReadoutView(deps.adapter);
    // First in the lead, before the debug tools' toggle.
    deps.lead.prepend(view.element);
    gpu ??= createGpuFrameTimer(deps.app);
    // Measurements left in flight when the counter went off belong to another stretch of play.
    gpu?.drain(discardGpu);
  };
  setShown(deps.initiallyShown);

  return {
    setShown,
    setCapFps: (capFps) => readings.setCapFps(capFps),
    gpuTimer(): GpuSpan | undefined {
      return shown ? (gpu ?? undefined) : undefined;
    },
    record(sample, shortfallSpeed): void {
      if (!shown || view === null) return;
      newest = (newest + 1) % GRAPH_FRAMES;
      frameTimes[newest] = sample.elapsedMs;
      gpu?.drain(takeGpu);
      const reading = readings.record(sample, shortfallSpeed);
      if (reading === null) return;
      latest = reading;
      for (let i = 0; i < GRAPH_FRAMES; i++) ordered[i] = frameTimes[(newest + 1 + i) % GRAPH_FRAMES] ?? 0;
      view.show(reading, ordered);
    },
    lastReading: () => latest,
    dispose(): void {
      view?.element.remove();
      gpu?.dispose();
    },
  };
}
