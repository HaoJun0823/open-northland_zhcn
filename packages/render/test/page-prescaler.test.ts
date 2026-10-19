import { type Renderer, TextureSource, WebGLRenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { hasPrescaledPages, prescaledPageOf } from '../src/gpu/pixel-art-registry.js';
import { PagePrescaler, PRESCALE_RECIPES } from '../src/gpu/prescale/page-prescaler.js';
import { PRESCALE_FACTOR } from '../src/gpu/prescale/prescale-pass.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

const MAX_TEXTURE_SIZE = 64;
const GL_MAX_TEXTURE_SIZE = 0x0d33;

/** A WebGL renderer that only records what each prescale draw targets. */
function recordingRenderer(): { renderer: Renderer; targets: { width: number; height: number }[] } {
  const targets: { width: number; height: number }[] = [];
  const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  Object.assign(renderer, {
    gl: {
      MAX_TEXTURE_SIZE: GL_MAX_TEXTURE_SIZE,
      getParameter: (name: number) => (name === GL_MAX_TEXTURE_SIZE ? MAX_TEXTURE_SIZE : 0),
    },
    render: ({ target }: { target: { source: TextureSource } }) =>
      targets.push({ width: target.source.pixelWidth, height: target.source.pixelHeight }),
  });
  return { renderer, targets };
}

function cacheOf(pages: TextureSource[]) {
  return {
    prescalableSources: () => pages,
    get prescalableRevision() {
      return pages.length;
    },
  };
}

const page = (width: number, height: number) => new TextureSource({ width, height });
let prescaler: PagePrescaler | null = null;

afterEach(() => {
  prescaler?.clear();
  prescaler = null;
});

describe('page prescaler', () => {
  useHeadlessShaderContext();

  it('redraws one page a frame into a twin twice its size, which the batch then finds', () => {
    const { renderer, targets } = recordingRenderer();
    prescaler = new PagePrescaler(renderer);
    const pages = [page(8, 4), page(6, 6)];
    prescaler.setScaler('xbrz');
    prescaler.update(cacheOf(pages));
    expect(targets).toEqual([{ width: 8 * PRESCALE_FACTOR, height: 4 * PRESCALE_FACTOR }]);
    expect(prescaler.stats()).toMatchObject({ pages: 1, pending: 1 });
    prescaler.update(cacheOf(pages));
    const [first, second] = pages;
    expect(prescaledPageOf(first as TextureSource)?.pixelWidth).toBe(8 * PRESCALE_FACTOR);
    expect(prescaledPageOf(second as TextureSource)?.pixelHeight).toBe(6 * PRESCALE_FACTOR);
    expect(prescaler.stats()).toMatchObject({ pages: 2, pending: 0, bytes: (16 * 8 + 12 * 12) * 4 });
    // Nothing new and nothing pending: no further draw.
    prescaler.update(cacheOf(pages));
    expect(targets).toHaveLength(2);
  });

  it("draws every pass of a scaler's recipe and keeps only the last as the twin", () => {
    const { renderer, targets } = recordingRenderer();
    prescaler = new PagePrescaler(renderer);
    const source = page(4, 4);
    prescaler.setScaler('superxbr');
    prescaler.update(cacheOf([source]));
    expect(targets).toHaveLength(PRESCALE_RECIPES.superxbr.length);
    expect(prescaledPageOf(source)?.pixelWidth).toBe(4 * PRESCALE_FACTOR);
  });

  it('leaves a page whose twin would outgrow the largest texture, and withdraws every twin on a switch', () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer);
    const small = page(8, 8);
    const tall = page(8, MAX_TEXTURE_SIZE);
    prescaler.setScaler('xbrz');
    prescaler.update(cacheOf([tall, small]));
    expect(prescaler.stats()).toMatchObject({ pages: 1, oversized: 1, pending: 0 });
    expect(prescaledPageOf(tall)).toBeUndefined();
    prescaler.setScaler(null);
    expect(prescaledPageOf(small)).toBeUndefined();
    expect(hasPrescaledPages()).toBe(false);
  });

  it('drops the twin of a page destroyed under it', () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer);
    const source = page(8, 8);
    prescaler.setScaler('xbrz');
    prescaler.update(cacheOf([source]));
    expect(hasPrescaledPages()).toBe(true);
    source.destroy();
    expect(prescaler.stats().pages).toBe(0);
    expect(hasPrescaledPages()).toBe(false);
  });
});
