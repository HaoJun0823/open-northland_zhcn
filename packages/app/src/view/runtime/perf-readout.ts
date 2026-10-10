import { createGpuFrameTimer, type GpuFrameTimer } from '@open-northland/render';
import type { Application } from 'pixi.js';
import type { FrameSample } from '../../diag/frame-stats.js';
import { type PerfReadingContext, PerfReadingWindow } from '../../diag/perf-reading.js';
import { createPerfReadoutView, type PerfReadoutView } from '../../hud/dom/perf-readout.js';
import type { ToolPanelController } from '../../hud/tool-panel/index.js';
import type { PerfReadoutMode } from '../settings-store.js';

/** The player's performance readout on the top bar, fed once a frame by the frame loop. */
export interface PerfReadout {
  setMode(mode: PerfReadoutMode): void;
  /** Bracket the frame's GPU submissions; both are no-ops unless the detail card is up. */
  beginGpu(): void;
  endGpu(): void;
  /** `shortfallSpeed` is the delivered speed while a sustained shortfall holds, else null. */
  record(sample: FrameSample, shortfallSpeed: number | null): void;
  dispose(): void;
}

export interface PerfReadoutDeps {
  readonly app: Application;
  readonly context: PerfReadingContext;
  readonly initialMode: PerfReadoutMode;
  /** The current tool panel controller; a HUD rescale replaces it and its bar. */
  readonly controller: () => Pick<ToolPanelController, 'showInBar'>;
}

/** About two seconds of frames at 60 fps: enough to see a hitch, short enough to read at a glance. */
const GRAPH_FRAMES = 120;

export function mountPerfReadout(deps: PerfReadoutDeps): PerfReadout {
  const readings = new PerfReadingWindow(deps.context);
  const frameTimes = new Float64Array(GRAPH_FRAMES);
  const ordered = new Float64Array(GRAPH_FRAMES);
  let newest = 0;
  let mode: PerfReadoutMode = 'off';
  // Built on the first use, so a player who keeps the readout off pays nothing for it.
  let view: PerfReadoutView | null = null;
  let gpu: GpuFrameTimer | null | undefined;
  let shownIn: Pick<ToolPanelController, 'showInBar'> | null = null;
  let gpuOpen = false;

  const takeGpu = (ms: number): void => readings.recordGpu(ms);
  const discardGpu = (): void => {};
  const detailsUp = (): boolean => mode === 'details' && gpu !== null && gpu !== undefined;

  const setMode = (next: PerfReadoutMode): void => {
    mode = next;
    if (next === 'off') {
      shownIn?.showInBar(null);
      shownIn = null;
      return;
    }
    view ??= createPerfReadoutView();
    view.setLook(next);
    if (next === 'details') gpu ??= createGpuFrameTimer(deps.app);
  };
  setMode(deps.initialMode);

  return {
    setMode,
    beginGpu(): void {
      if (!detailsUp()) return;
      gpu?.begin();
      gpuOpen = true;
    },
    endGpu(): void {
      if (!gpuOpen) return;
      gpu?.end();
      gpuOpen = false;
    },
    record(sample, shortfallSpeed): void {
      if (mode === 'off' || view === null) return;
      const controller = deps.controller();
      if (controller !== shownIn) {
        controller.showInBar(view.element);
        shownIn = controller;
      }
      newest = (newest + 1) % GRAPH_FRAMES;
      frameTimes[newest] = sample.elapsedMs;
      // Drained in either look, so a return to the details takes no measurement from before it.
      gpu?.drain(mode === 'details' ? takeGpu : discardGpu);
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
