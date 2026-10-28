import { type Application, Container, type RenderTexture, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { OffscreenWorld } from '../../../src/gpu/world-renderer/offscreen-world.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

/** A stage with the renderer's scene at its bottom, a canvas at `resolution`, and spies for the two
 *  renders a frame makes: the scene into its frame, then the stage. */
function stubApp(resolution: number) {
  const stage = new Container();
  const scene = new Container();
  scene.label = 'world-scene';
  stage.addChild(scene);
  const hud = new Container();
  stage.addChild(hud);
  const targets: RenderTexture[] = [];
  const renderer = {
    resolution,
    render: vi.fn((options: { target?: RenderTexture }) => {
      if (options.target !== undefined) targets.push(options.target);
    }),
    renderTarget: { getRenderTarget: () => ({ isRoot: false }) },
  };
  const app = { stage, screen: { width: 800, height: 600 }, renderer, render: vi.fn() };
  return { app: app as unknown as Application & typeof app, stage, scene, hud, renderer, targets };
}

const presentOf = (stage: Container) => stage.getChildByLabel('offscreen-world');
/** World texels per device pixel, as the quad's magnifier reads it. */
const texelsPerPixel = (upscale: OffscreenWorld): number | undefined =>
  (upscale as unknown as { uniforms: { uniforms: { uUpscale: Float32Array } } }).uniforms.uniforms
    .uUpscale[1];

describe('OffscreenWorld', () => {
  useHeadlessShaderContext();

  it('draws the scene into one kept frame while the canvas is denser, the stage over its quad', () => {
    const { app, stage, scene, hud, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, 'sharp', 1);
    upscale.render();
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), hud]);
    expect(presentOf(stage)?.visible).toBe(true);
    expect(targets).toHaveLength(2);
    expect(targets[1]).toBe(targets[0]);
    expect(app.render).toHaveBeenCalledTimes(2);
    expect(upscale.drawResolution()).toBe(1);
    expect(texelsPerPixel(upscale)).toBe(0.5);
    upscale.destroy();
  });

  it('keeps the frame under a render scale whose texels do not divide the screen', () => {
    const { app, scene, targets } = stubApp(2);
    app.screen.width = 801;
    app.screen.height = 601;
    const upscale = new OffscreenWorld(app, scene, 'xbr', 1.3);
    upscale.render();
    upscale.render();
    expect(targets[1]).toBe(targets[0]);
    upscale.destroy();
  });

  it('makes a new frame after a resize and keeps it after', () => {
    const { app, scene, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, 'sharp', 1);
    upscale.render();
    app.screen.width = 1024;
    upscale.render();
    upscale.render();
    expect(targets[1]).not.toBe(targets[0]);
    expect(targets[2]).toBe(targets[1]);
    expect(targets[0]?.destroyed).toBe(true);
    upscale.destroy();
  });

  it('puts the scene back above the quad when the canvas is no denser, and leaves again', () => {
    const { app, stage, scene, hud, renderer, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, 'sharp', 1);
    upscale.render();
    renderer.resolution = 1;
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), scene, hud]);
    expect(presentOf(stage)?.visible).toBe(false);
    expect(targets).toHaveLength(1);
    renderer.resolution = 2;
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), hud]);
    expect(targets).toHaveLength(2);
    expect(texelsPerPixel(upscale)).toBe(0.5);
    upscale.destroy();
  });
});

describe('OffscreenWorld at night', () => {
  useHeadlessShaderContext();

  it('draws a canvas no denser than the world into its frame while a night composite lights it', () => {
    const { app, stage, scene, hud, targets } = stubApp(1);
    const frame = new OffscreenWorld(app, scene, 'sharp', Number.POSITIVE_INFINITY);
    frame.render();
    expect(targets).toHaveLength(0);
    frame.render({ light: Texture.WHITE, lit: [1, 1, 1] });
    expect(stage.children).toEqual([presentOf(stage), hud]);
    expect(targets).toHaveLength(1);
    expect(texelsPerPixel(frame)).toBe(1);
    frame.render();
    expect(stage.children).toEqual([presentOf(stage), scene, hud]);
    frame.destroy();
  });
});
