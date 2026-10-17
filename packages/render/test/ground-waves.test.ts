import { Container, type Renderer, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { Viewport } from '../src/data/projection/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { type GroundWave, GroundWaveLayer, groundWaveFrameAt } from '../src/gpu/ground-waves/index.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 4, offsetX: -4, offsetY: -2 };
const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 4, offsetX: -4, offsetY: -2 };
const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const ELSEWHERE: Viewport = { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 };
const CAMERA = { offsetX: 0, offsetY: 0, scale: 1 };
const SCREEN = 640;

function wave(phase = 0): GroundWave {
  return { x: 0, y: 0, source: Texture.WHITE.source, frames: [FRAME_0, FRAME_1], phase };
}

function fakeRenderer(): {
  renderer: Renderer;
  render: ReturnType<typeof vi.fn>;
  restoreContext: () => void;
} {
  const render = vi.fn();
  const listeners = new Set<{ contextChange: () => void }>();
  const contextChange = {
    add: (listener: { contextChange: () => void }) => listeners.add(listener),
    remove: (listener: { contextChange: () => void }) => listeners.delete(listener),
  };
  return {
    renderer: { resolution: 1, render, runners: { contextChange } } as unknown as Renderer,
    render,
    restoreContext: () => {
      for (const listener of listeners) listener.contextChange();
    },
  };
}

describe('groundWaveFrameAt', () => {
  it('advances one frame per tick from the placement phase', () => {
    expect(groundWaveFrameAt(wave(1), 0)).toBe(FRAME_1);
    expect(groundWaveFrameAt(wave(1), 1)).toBe(FRAME_0);
    expect(groundWaveFrameAt(wave(0), 3)).toBe(FRAME_1);
  });
});

describe('GroundWaveLayer', () => {
  it('filters the ground only while a wave is on screen and motion is on', () => {
    const ground = new Container();
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, ground);
    layer.set([wave()]);

    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(ground.filters).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);

    layer.update(ELSEWHERE, CAMERA, SCREEN, SCREEN, 1, true);
    expect(ground.filters).toBeNull();

    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 2, false);
    expect(ground.filters).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('redraws the lift map only when the tick, the camera, the screen or the waves change', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    const waves = [wave(), { ...wave(), x: 40 }];
    layer.set(waves);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(1);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 1, true);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN, 1, true);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN / 2, 1, true);
    layer.remove(waves[1] as GroundWave);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN / 2, 1, true);
    expect(render).toHaveBeenCalledTimes(5);
  });

  it('draws the lift map again after the GL context was restored, although nothing else changed', () => {
    const { renderer, render, restoreContext } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    restoreContext();
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(2);
    layer.destroy();
    restoreContext();
  });

  it('draws the waves of the blocks under the view in placement order, whatever their position', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    // The first wave placed lies in a block to the right of the second's, which sits left of the origin.
    const right = 3000;
    const left = -100;
    layer.set([
      { ...wave(), x: right },
      { ...wave(), x: left },
    ]);
    layer.update({ minX: -1000, minY: -1000, maxX: 4000, maxY: 1000 }, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(1);
    const root = render.mock.calls[0]?.[0].container as Container;
    const drawn = root.children[0]?.children.filter((sprite) => sprite.visible) ?? [];
    expect(drawn.map((sprite) => sprite.x)).toEqual([right + FRAME_0.offsetX, left + FRAME_0.offsetX]);

    layer.update({ minX: right + 1, minY: -1, maxX: right + 2, maxY: 1 }, CAMERA, SCREEN, SCREEN, 1, true);
    expect(root.children[0]?.children.filter((sprite) => sprite.visible)).toHaveLength(0);
  });

  it('stops lifting the ground once its only wave is removed', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    const only = wave();
    layer.set([only]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    layer.remove(only);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 1, true);
    expect(ground.filters).toBeNull();
  });

  it('turns the lift off for a framed view and back on after it', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    const filter = ground.filters?.[0];

    layer.suspend(true);
    expect(filter?.enabled).toBe(false);
    layer.suspend(false);
    expect(filter?.enabled).toBe(true);
  });

  it('lets go of a lift map before destroying it on a resize and on teardown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const layer = new GroundWaveLayer(fakeRenderer().renderer, new Container());
      layer.set([wave()]);
      layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
      layer.update(WIDE, CAMERA, SCREEN / 2, SCREEN, 1, true);
      layer.destroy();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
