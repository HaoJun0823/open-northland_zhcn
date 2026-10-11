import type { Application, Container, Rectangle, RenderOptions, Sprite } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import { restoreStash, stashHidden } from '../visibility.js';

/** Pixi's public `RenderOptions` omits `frame`, though the runtime honours it as the viewport region in
 *  the target's logical px. Undocumented API, verified on pixi.js 8.19: re-verify on a Pixi bump, since
 *  a dropped `frame` would paint the re-aimed world over the whole canvas instead of the box. */
interface FramedRenderOptions extends RenderOptions {
  readonly frame: Rectangle;
}

/** One re-aimed render of the world into a screen region. */
export interface FramedWorldRender {
  /** Frame-local: `offsetX`/`offsetY` place the world relative to the frame's top-left. */
  readonly camera: Camera;
  /** The screen region painted, in logical px. */
  readonly frame: Rectangle;
  /** The `0xRRGGBB` floor under the world; null keeps whatever the stage render left there. */
  readonly fill: number | null;
  /** The one world layer left visible, for a render of a single subject; null draws them all. */
  readonly keep: Container | null;
}

/**
 * Paint `floor` over the frame alone in `fill`. A render of its own rather than a child of the world: a
 * quad parented into `worldLayer` for the pass would change the world group's structure, and Pixi would
 * rebuild its instructions and re-upload its buffers for the pass and again for the next main render.
 */
export function renderFloor(app: Application, floor: Sprite, frame: Rectangle, fill: number): void {
  floor.tint = fill;
  floor.position.set(0, 0);
  floor.width = frame.width;
  floor.height = frame.height;
  const options: FramedRenderOptions = { container: floor, clear: false, frame };
  app.renderer.render(options);
}

/**
 * A second, frame-limited screen render of `worldLayer` re-aimed by `pass.camera`, painted over what the
 * stage render drew (`clear: false`), so it must run after that render. The floor goes down first. The
 * world transform and the layer visibilities are restored even if the render throws.
 */
export function renderFramedWorld(
  app: Application,
  worldLayer: Container,
  floor: Sprite,
  pass: FramedWorldRender,
): void {
  if (pass.fill !== null) renderFloor(app, floor, pass.frame, pass.fill);
  const scale = pass.camera.scale ?? 1;
  const saved = { scale: worldLayer.scale.x, x: worldLayer.position.x, y: worldLayer.position.y };
  worldLayer.scale.set(scale);
  worldLayer.position.set(pass.camera.offsetX, pass.camera.offsetY);
  const stash = pass.keep === null ? null : stashHidden(worldLayer.children, pass.keep);
  try {
    const options: FramedRenderOptions = { container: worldLayer, clear: false, frame: pass.frame };
    app.renderer.render(options);
  } finally {
    if (stash !== null) restoreStash(stash);
    worldLayer.scale.set(saved.scale);
    worldLayer.position.set(saved.x, saved.y);
  }
}
