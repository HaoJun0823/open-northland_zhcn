import type { WorldSnapshot } from '@open-northland/sim';
import { type MinimapDotContext, MinimapDotPlot, type MinimapDotSink } from '../../src/hud/minimap/dots.js';

/** The whole dot plot of `snapshot` in one step, as the minimap stamps it over several frames. */
export function forEachMinimapDot(
  snapshot: WorldSnapshot,
  ctx: MinimapDotContext,
  sink: MinimapDotSink,
): void {
  const plot = new MinimapDotPlot();
  plot.start(ctx);
  plot.step(snapshot, sink);
}
