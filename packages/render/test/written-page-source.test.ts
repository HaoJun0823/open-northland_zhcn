import { CanvasSource, type GlRenderingContext, type GlTexture, glUploadImageResource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WRITTEN_PAGE_UPLOADER, WrittenPageSource } from '../src/gpu/written-page-source.js';

afterEach(() => vi.restoreAllMocks());

describe('written page upload', () => {
  const SIDE = 1024;
  const gl = () => {
    const calls: unknown[][] = [];
    const context = {
      UNPACK_SKIP_PIXELS: 1,
      UNPACK_SKIP_ROWS: 2,
      pixelStorei: (...a: unknown[]) => calls.push(['store', ...a]),
      texSubImage2D: (...a: unknown[]) => calls.push(['sub', ...a.slice(0, 6)]),
    };
    return { context: context as unknown as GlRenderingContext, calls };
  };
  const held = (width: number) =>
    ({ width, height: width, target: 7, format: 8, type: 9 }) as unknown as GlTexture;

  it('uploads only the written rectangles to a texture the GPU holds, and the whole page otherwise', () => {
    const canvas = { width: SIDE, height: SIDE } as unknown as HTMLCanvasElement;
    const source = new WrittenPageSource(canvas);
    const whole = vi.spyOn(glUploadImageResource, 'upload').mockImplementation(() => {});
    source.markWritten(64, 96, 64, 32);
    source.markWritten(32, 0, 32, 32);
    const { context, calls } = gl();
    WRITTEN_PAGE_UPLOADER.upload(source, held(SIDE), context, 2);
    expect(whole).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ['store', 1, 64],
      ['store', 2, 96],
      ['sub', 7, 0, 64, 96, 64, 32],
      ['store', 1, 32],
      ['store', 2, 0],
      ['sub', 7, 0, 32, 0, 32, 32],
      ['store', 1, 0],
      ['store', 2, 0],
    ]);
    expect(source.written).toEqual([]);
    // A texture not yet allocated at the page's size takes the whole page, and forgets the rectangles.
    source.markWritten(0, 0, 32, 32);
    WRITTEN_PAGE_UPLOADER.upload(source, held(0), context, 2);
    expect(whole).toHaveBeenCalledTimes(1);
    expect(source.written).toEqual([]);
    // Nothing recorded: the whole page, as Pixi would.
    WRITTEN_PAGE_UPLOADER.upload(source, held(SIDE), context, 2);
    expect(whole).toHaveBeenCalledTimes(2);
    source.destroy();
  });

  it('hands a forced allocation, WebGL 1 and any other source straight to the image upload', () => {
    const canvas = { width: SIDE, height: SIDE } as unknown as HTMLCanvasElement;
    const whole = vi.spyOn(glUploadImageResource, 'upload').mockImplementation(() => {});
    const { context, calls } = gl();
    const page = new WrittenPageSource(canvas);
    page.markWritten(0, 0, 32, 32);
    WRITTEN_PAGE_UPLOADER.upload(page, held(SIDE), context, 2, 7, true);
    expect(whole).toHaveBeenLastCalledWith(page, held(SIDE), context, 2, 7, true);
    expect(page.written).toEqual([]);
    page.markWritten(0, 0, 32, 32);
    WRITTEN_PAGE_UPLOADER.upload(page, held(SIDE), context, 1);
    expect(whole).toHaveBeenLastCalledWith(page, held(SIDE), context, 1, undefined, false);
    const plain = new CanvasSource({ resource: canvas });
    WRITTEN_PAGE_UPLOADER.upload(plain, held(SIDE), context, 2, 7);
    expect(whole).toHaveBeenLastCalledWith(plain, held(SIDE), context, 2, 7, false);
    expect(calls).toEqual([]);
    page.destroy();
    plain.destroy();
  });
});
