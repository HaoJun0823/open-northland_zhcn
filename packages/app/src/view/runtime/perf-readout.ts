import { createGpuFrameTimer, type GpuFrameTimer } from '@open-northland/render';
import type { Application } from 'pixi.js';
import type { FrameSample } from '../../diag/frame-stats.js';
import { type PerfReadingContext, PerfReadingWindow } from '../../diag/perf-reading.js';
import { createPerfReadoutView, type PerfReadoutView } from '../../hud/dom/perf-readout.js';
import type { ToolPanelController } from '../../hud/tool-panel/index.js';

/** The player's frame-rate counter on the top bar, fed once a frame by the frame loop. */
export interface PerfReadout {
  setShown(shown: boolean): void;
  /** Bracket the frame's GPU submissions; both are no-ops while the counter is off. */
  beginGpu(): void;
  endGpu(): void;
  /** `shortfallSpeed` is the delivered speed while a sustained shortfall holds, else null. */
  record(sample: FrameSample, shortfallSpeed: number | null): void;
  dispose(): void;
}

export interface PerfReadoutDeps {
  readonly app: Application;
  readonly context: PerfReadingContext;
  readonly initiallyShown: boolean;
  /** The current tool panel controller; a HUD rescale replaces it and its bar. */
  readonly controller: () => Pick<ToolPanelController, 'showInBar'>;
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
  let gpu: GpuFrameTimer | null | undefined;
  let shownIn: Pick<ToolPanelController, 'showInBar'> | null = null;
  let gpuOpen = false;
  const takeGpu = (ms: number): void => readings.recordGpu(ms);
  const discardGpu = (): void => {};

  const setShown = (next: boolean): void => {
    shown = next;
    if (!next) {
      shownIn?.showInBar(null);
      shownIn = null;
      return;
    }
    view ??= createPerfReadoutView();
    gpu ??= createGpuFrameTimer(deps.app);
    // Measurements left in flight when the counter went off belong to another stretch of play.
    gpu?.drain(discardGpu);
  };
  setShown(deps.initiallyShown);

  return {
    setShown,
    beginGpu(): void {
      if (!shown || gpu === null || gpu === undefined) return;
      gpu.begin();
      gpuOpen = true;
    },
    endGpu(): void {
      if (!gpuOpen) return;
      gpu?.end();
      gpuOpen = false;
    },
    record(sample, shortfallSpeed): void {
      if (!shown || view === null) return;
      const controller = deps.controller();
      if (controller !== shownIn) {
        controller.showInBar(view.element);
        shownIn = controller;
      }
      newest = (newest + 1) % GRAPH_FRAMES;
      frameTimes[newest] = sample.elapsedMs;
      gpu?.drain(takeGpu);
      const reading = readings.record(sample, shortfallSpeed);
      if (reading === null) return;
      for (let i = 0; i < GRAPH_FRAMES; i++) ordered[i] = frameTimes[(newest + 1 + i) % GRAPH_FRAMES] ?? 0;
      view.show(reading, ordered);
    },
    dispose(): void {
      shownIn?.showInBar(null);
      gpu?.dispose();
    },
  };
}
