import type { DrawItem, ResolvedLayer, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FigureFrameImage, FigureFrames } from '../src/hud/figures/figure-frames.js';
import { FigureScene } from '../src/hud/figures/figure-scene.js';
import { type NoticeFigureSlot, NoticeFigures } from '../src/hud/tool-panel/messages/figures.js';

const BOX = { width: 10, height: 12, pixelScale: 1 };
const snapshot = {} as WorldSnapshot;
const SETTLER = 1;

/** The settler's current animation image; a test replaces it to make a new picture. */
let picture: FigureFrameImage | null = null;
const image = (): FigureFrameImage =>
  ({ image: {} as CanvasImageSource, x: 0, y: 0, width: 1, height: 1 }) as FigureFrameImage;

function painter() {
  vi.spyOn(FigureScene.prototype, 'items').mockImplementation(
    (_snap, subjects) => new Map(subjects.map((ref) => [ref, { kind: 'settler', ref } as DrawItem])),
  );
  vi.spyOn(FigureScene.prototype, 'layers').mockImplementation(() => [
    { scale: 1, frame: { offsetY: 0 } } as unknown as ResolvedLayer,
  ]);
  const frames = {
    resolve: vi.fn((_layers: readonly ResolvedLayer[], _item: DrawItem, out: (FigureFrameImage | null)[]) => {
      out.length = 0;
      out.push(picture);
      return true;
    }),
    paint: vi.fn(),
  };
  const figures = new NoticeFigures({} as SpriteSheet, frames as unknown as FigureFrames);
  const ctx = { clearRect: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const slots: NoticeFigureSlot[] = [{ entity: SETTLER, canvas, visible: BOX.height }];
  const render = (): void => figures.render(snapshot, slots, BOX, 0, 0, () => {});
  return { frames, ctx, canvas, render };
}

afterEach(() => {
  vi.restoreAllMocks();
  picture = null;
});

describe('notice figures', () => {
  it('paints a card figure when its picture changes and leaves the canvas alone while it holds', () => {
    const { frames, ctx, render } = painter();
    picture = image();
    render();
    render();
    expect(frames.paint).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);

    picture = image();
    render();
    expect(frames.paint).toHaveBeenCalledTimes(2);
  });

  it('paints again after the canvas was resized, which cleared it', () => {
    const { frames, canvas, render } = painter();
    picture = image();
    render();
    (canvas as { width: number }).width = 0;
    render();
    expect(frames.paint).toHaveBeenCalledTimes(2);
  });
});
