import type { FrameStatsReport } from '../frame-stats.js';

/** What the running game view lends a report: its picture, its frame timing and its saves' key. */
export interface ReportGameView {
  /** The world as the player sees it, encoded at most `maxWidth` wide; null where it cannot be drawn. */
  screenshot(maxWidth: number, quality: number): Promise<Blob | null>;
  frames(): FrameStatsReport;
  /** The key the world's autosaves rotate under; null for a world that keeps none. */
  readonly worldToken: string | null;
  /** The world's seed, which every save of this playthrough keeps. */
  readonly seed: number | null;
}

let current: ReportGameView | null = null;

/** The view that registers clears its registration when it closes, with the function answered. */
export function setReportGameView(view: ReportGameView): () => void {
  current = view;
  return () => {
    if (current === view) current = null;
  };
}

export function reportGameView(): ReportGameView | null {
  return current;
}
