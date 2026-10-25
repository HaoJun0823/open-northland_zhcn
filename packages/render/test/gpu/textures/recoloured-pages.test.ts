import { colourIndexedSheet, GREY_ALPHA_INDEXED } from '@open-northland/formats/atlas/paletted-sheet';
import { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import { isIndexedSource, palettedLutOf, palettedRowOf } from '../../../src/gpu/pixel-art/registry.js';
import { PaletteRowsLut } from '../../../src/gpu/textures/palette-rows-lut.js';
import {
  colourRecolouredFrame,
  copyRecolour,
  drawableFrame,
  frameImageData,
  RecolouredPageSource,
  readFrameRgba,
  recolourOf,
  registerRecolouredFrames,
} from '../../../src/gpu/textures/recoloured-pages.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';

const WIDTH = 7;
const HEIGHT = 5;
const RGB = 3;
const RGBA = 4;

/** Every (index, coverage) pair a sheet can hold, coverage 0 and partial among them. */
function syntheticSheet(): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 2);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 2] = (i * 37) % 256;
    pixels[i * 2 + 1] = [0, 1, 128, 254, 255][i % 5] ?? 0;
  }
  return pixels;
}

function palette(seed: number): Uint8Array {
  return Uint8Array.from({ length: 256 * RGB }, (_, i) => (i * seed + 11) % 256);
}

const frameAt = (x: number, y: number, width: number, height: number): AtlasFrame => ({
  x,
  y,
  width,
  height,
  offsetX: 0,
  offsetY: 0,
});

describe('RecolouredPageSource', () => {
  it('is an indexed RG8 page holding the sheet bytes as they are', () => {
    const pixels = syntheticSheet();
    const page = new RecolouredPageSource(pixels, WIDTH, HEIGHT);
    expect(page.format).toBe('rg8unorm');
    expect(page.indexCoverage).toBe(pixels);
    expect(isIndexedSource(page)).toBe(true);
    // A straight-alpha label would make Pixi blend the premultiplied shader output again.
    expect(page.alphaMode).toBe('premultiply-alpha-on-upload');
  });

  it("takes the world's sampling flip as a name for its copies, its sampler staying nearest", () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    page.scaleMode = 'linear';
    expect(page.scaleMode).toBe('linear');
    expect(page.style.magFilter).toBe('nearest');
    expect(page.style.minFilter).toBe('nearest');
  });

  it('refuses bytes that do not fill the page', () => {
    expect(() => new RecolouredPageSource(new Uint8Array(3), WIDTH, HEIGHT)).toThrow(/bytes/);
  });
});

describe('colourRecolouredFrame', () => {
  it('colours a frame exactly as the whole sheet is coloured for its RGBA page', () => {
    const pixels = syntheticSheet();
    const colours = palette(5);
    const whole = new Uint8Array(WIDTH * HEIGHT * RGBA);
    colourIndexedSheet(pixels, GREY_ALPHA_INDEXED, colours, whole);
    const frame = frameAt(2, 1, 4, 3);
    const out = new Uint8Array(frame.width * frame.height * RGBA);
    colourRecolouredFrame(new RecolouredPageSource(pixels, WIDTH, HEIGHT), frame, colours, out);
    for (let y = 0; y < frame.height; y++) {
      const row = whole.subarray(
        ((frame.y + y) * WIDTH + frame.x) * RGBA,
        ((frame.y + y) * WIDTH + frame.x + frame.width) * RGBA,
      );
      expect(Array.from(out.subarray(y * frame.width * RGBA, (y + 1) * frame.width * RGBA))).toEqual(
        Array.from(row),
      );
    }
  });
});

describe('reading a recoloured frame', () => {
  it("colours it straight, and into a reader's image at an offset on clear ground", () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    const frame = frameAt(1, 1, 3, 2);
    const colours = palette(9);
    registerRecolouredFrames([frame], colours);
    const expected = new Uint8Array(frame.width * frame.height * RGBA);
    colourRecolouredFrame(page, frame, colours, expected);
    expect(Array.from(readFrameRgba(page, frame) ?? [])).toEqual(Array.from(expected));
    const PAD = 1;
    const width = frame.width + 2 * PAD;
    const height = frame.height + 2 * PAD;
    const ctx = {
      canvas: { width, height },
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * RGBA),
        width: w,
        height: h,
      }),
    } as unknown as CanvasRenderingContext2D;
    const image = frameImageData(ctx, page, frame, PAD, PAD);
    if (image === null) throw new Error('unreadable');
    const rowBytes = frame.width * RGBA;
    expect(Array.from(image.data.subarray(0, width * RGBA)).every((byte) => byte === 0)).toBe(true);
    for (let y = 0; y < frame.height; y++) {
      const at = ((y + PAD) * width + PAD) * RGBA;
      expect(Array.from(image.data.subarray(at, at + rowBytes))).toEqual(
        Array.from(expected.subarray(y * rowBytes, (y + 1) * rowBytes)),
      );
    }
  });
});

describe('recoloured frames', () => {
  it('name the palette their stem registered, and only theirs', () => {
    const a = frameAt(0, 0, 2, 2);
    const b = frameAt(0, 0, 2, 2);
    const colours = palette(3);
    registerRecolouredFrames([a], colours);
    expect(recolourOf(a)).toBe(colours);
    expect(recolourOf(b)).toBeUndefined();
    // A frame derived by spreading a recoloured one draws through the same palette.
    expect(recolourOf({ ...a, height: 1 })).toBe(colours);
    expect(() => registerRecolouredFrames([b], new Uint8Array(RGB))).toThrow(/palette/);
  });

  it('cannot be read from a recoloured page without a palette', () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    expect(drawableFrame(page, frameAt(0, 0, 2, 2))).toBeNull();
  });
});

describe('TextureCache over a recoloured page', () => {
  it('draws each stem through its own LUT row, off the prescaled pages', () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    const lut = new PaletteRowsLut();
    const cache = new TextureCache();
    cache.setRecolourLut(lut);
    const one = frameAt(0, 0, 3, 3);
    const two = frameAt(0, 0, 3, 3);
    registerRecolouredFrames([one], palette(3));
    registerRecolouredFrames([two], palette(7));
    const a = cache.get(page, one);
    const b = cache.get(page, two);
    expect(a.source).toBe(page);
    expect(palettedLutOf(a)).toBe(lut.source);
    expect(palettedRowOf(a)).toBe(0);
    expect(palettedRowOf(b)).toBe(1);
    expect(palettedRowOf(cache.cropped(page, two, 1))).toBe(1);
    expect(cache.pageSources().has(page)).toBe(false);
    expect(cache.recolourRow(page, two)).toBe(1);
  });

  it("gives an unmagnified twin its view's row", () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    const cache = new TextureCache();
    const frame = frameAt(1, 1, 2, 2);
    registerRecolouredFrames([frame], palette(9));
    const view = cache.get(page, frame);
    const twin = cache.unmagnified(view);
    expect(palettedRowOf(twin)).toBe(palettedRowOf(view));
    const plain = new Texture();
    copyRecolour(plain, new Texture());
    expect(palettedLutOf(plain)).toBeUndefined();
  });

  it('keeps a recoloured page from every prescaler, which would rescale its indices', () => {
    const page = new RecolouredPageSource(syntheticSheet(), WIDTH, HEIGHT);
    const cache = new TextureCache();
    const frame = frameAt(0, 0, 2, 2);
    registerRecolouredFrames([frame], palette(4));
    cache.get(page, frame);
    expect(cache.isPrescalable(page)).toBe(false);
  });

  it('answers -1 for a frame of a coloured page', () => {
    const cache = new TextureCache();
    expect(cache.recolourRow(Texture.WHITE.source, frameAt(0, 0, 1, 1))).toBe(-1);
  });
});

describe('PaletteRowsLut', () => {
  it('draws a palette past its rows through the first row, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lut = new PaletteRowsLut(1);
    expect(lut.fixedRow(palette(3))).toBe(0);
    expect(lut.fixedRow(palette(5))).toBe(0);
    expect(lut.fixedRow(palette(7))).toBe(0);
    expect(lut.overflows).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives each stem palette a row of its own, even one with the same entries', () => {
    const lut = new PaletteRowsLut();
    const stem = palette(3);
    expect(lut.fixedRow(stem)).toBe(0);
    expect(lut.fixedRow(palette(3))).toBe(1);
    expect(lut.fixedRow(stem)).toBe(0);
  });
});
