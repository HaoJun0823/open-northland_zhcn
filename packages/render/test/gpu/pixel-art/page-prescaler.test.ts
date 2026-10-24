import { type Renderer, SystemRunner, TextureSource, WebGLRenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PagePrescaler,
  PRESCALE_RECIPES,
  type PrescalableSources,
  type PrescaleLimits,
} from '../../../src/gpu/pixel-art/page-prescaler.js';
import { PRESCALE_FACTOR } from '../../../src/gpu/pixel-art/prescale-pass.js';
import {
  hasPrescaledPages,
  isCollectingDrawnPages,
  noteDrawnPage,
  prescaledPageOf,
} from '../../../src/gpu/pixel-art/registry.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

const MAX_TEXTURE_SIZE = 64;
const GL_MAX_TEXTURE_SIZE = 0x0d33;
const GL_MAX_VIEWPORT_DIMS = 0x0d3a;
const GL_LINK_STATUS = 0x8b82;
/** Frames past which an idle twin is swept: the sweep runs every sixty frames. */
const SWEEP_FRAMES = 60;

/** A WebGL renderer that only records what each prescale draw targets; `linked` is what it answers for
 *  every program's link status and `refuse` a target width whose draw throws. */
function recordingRenderer({ linked = true, refuse = 0 } = {}) {
  const targets: { width: number; height: number }[] = [];
  const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  const contextChange = new SystemRunner('contextChange');
  Object.assign(renderer, {
    gl: {
      MAX_TEXTURE_SIZE: GL_MAX_TEXTURE_SIZE,
      MAX_VIEWPORT_DIMS: GL_MAX_VIEWPORT_DIMS,
      getParameter: (name: number) =>
        name === GL_MAX_TEXTURE_SIZE
          ? MAX_TEXTURE_SIZE
          : name === GL_MAX_VIEWPORT_DIMS
            ? [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE]
            : 0,
      LINK_STATUS: GL_LINK_STATUS,
      getProgramParameter: (_program: unknown, name: number) => (name === GL_LINK_STATUS ? linked : null),
    },
    shader: { _getProgramData: () => ({ program: {} }) },
    runners: { contextChange },
    render: ({ target }: { target: { source: TextureSource } }) => {
      if (target.source.pixelWidth === refuse) throw new Error('pass refused');
      targets.push({ width: target.source.pixelWidth, height: target.source.pixelHeight });
    },
  });
  return { renderer: renderer as Renderer, targets, contextChange };
}

const EVERY_PAGE: PrescalableSources = { isPrescalable: () => true };
const ROOMY: PrescaleLimits = { texelsPerFrame: 1 << 20, budgetBytes: 1 << 30, idleFrames: 1 << 20 };
const page = (width: number, height: number) => new TextureSource({ width, height });

/** One frame in which the batches drew `pages`. */
function frame(prescaler: PagePrescaler, pages: readonly TextureSource[], from = EVERY_PAGE): void {
  for (const drawn of pages) noteDrawnPage(drawn);
  prescaler.update(from);
}

let prescaler: PagePrescaler | null = null;

afterEach(() => {
  prescaler?.destroy();
  prescaler = null;
});

describe('page prescaler', () => {
  useHeadlessShaderContext();

  it('redraws only the pages drawn, a band of rows a frame, into twins twice their size', () => {
    const { renderer, targets } = recordingRenderer();
    const twinRow = 8 * PRESCALE_FACTOR;
    prescaler = new PagePrescaler(renderer, { ...ROOMY, texelsPerFrame: twinRow * twinRow * 0.5 });
    const drawn = page(8, 8);
    const undrawn = page(8, 8);
    prescaler.setScaler('xbrz');
    frame(prescaler, [drawn]);
    expect(targets).toEqual([{ width: twinRow, height: twinRow }]);
    expect(prescaledPageOf(drawn)).toBeUndefined();
    expect(prescaler.stats()).toMatchObject({ pages: 0, pending: 1 });
    frame(prescaler, [drawn]);
    const twin = prescaledPageOf(drawn);
    expect(twin?.pixelWidth).toBe(twinRow);
    expect(prescaledPageOf(undrawn)).toBeUndefined();
    expect(prescaler.stats()).toMatchObject({ pages: 1, pending: 0 });
    // A page twin keeps one mip level, at the page's own resolution, generated once drawn.
    expect([twin?.mipLevelCount, twin?.autoGenerateMipmaps]).toEqual([2, true]);
    expect(prescaler.stats().bytes).toBe((16 * 16 + 8 * 8) * 4);
  });

  it("keeps a mipmapped bake's whole chain on its twin", () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const bake = new TextureSource({ width: 8, height: 8, autoGenerateMipmaps: true });
    prescaler.setScaler('xbrz');
    frame(prescaler, [bake]);
    expect(prescaledPageOf(bake)?.mipLevelCount).toBe(Math.log2(8 * PRESCALE_FACTOR) + 1);
  });

  it("draws every pass of a scaler's recipe and keeps only the last as the twin", () => {
    const { renderer, targets } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const source = page(4, 4);
    prescaler.setScaler('superxbr');
    frame(prescaler, [source]);
    expect(targets.map((target) => target.width)).toEqual(
      PRESCALE_RECIPES.superxbr.map((pass) => 4 * pass.scale),
    );
    expect(prescaledPageOf(source)?.pixelWidth).toBe(4 * PRESCALE_FACTOR);
  });

  it('holds a page past the memory budget back until the least recently drawn twin leaves the view', () => {
    const { renderer } = recordingRenderer();
    const oneTwin = (16 * 16 + 8 * 8) * 4;
    prescaler = new PagePrescaler(renderer, { ...ROOMY, budgetBytes: oneTwin });
    const [first, second] = [page(8, 8), page(8, 8)];
    prescaler.setScaler('xbrz');
    frame(prescaler, [first]);
    frame(prescaler, [first, second]);
    expect(prescaler.stats()).toMatchObject({ pages: 1, pending: 1, overBudget: 1 });
    expect(prescaledPageOf(second)).toBeUndefined();
    // Once the first page has not been drawn for a while, its memory goes to the second.
    for (let i = 0; i < SWEEP_FRAMES + 1; i++) frame(prescaler, [second]);
    expect(prescaledPageOf(first)).toBeUndefined();
    expect(prescaledPageOf(second)).toBeDefined();
  });

  it('frees a twin whose page has not been drawn for its idle frames', () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, { ...ROOMY, idleFrames: 1 });
    const source = page(8, 8);
    prescaler.setScaler('xbrz');
    frame(prescaler, [source]);
    expect(hasPrescaledPages()).toBe(true);
    for (let i = 0; i < SWEEP_FRAMES; i++) frame(prescaler, []);
    expect(hasPrescaledPages()).toBe(false);
  });

  it('withdraws every twin when the GL context comes back, and redraws them as they are drawn again', () => {
    const { renderer, contextChange } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const source = page(8, 8);
    prescaler.setScaler('xbrz');
    frame(prescaler, [source]);
    expect(prescaledPageOf(source)).toBeDefined();
    contextChange.emit();
    expect(hasPrescaledPages()).toBe(false);
    expect(prescaler.stats().scaler).toBe('xbrz');
    frame(prescaler, [source]);
    expect(prescaledPageOf(source)).toBeDefined();
  });

  it('holds after a second context loss under one scaler, until the scaler changes', () => {
    const { renderer, contextChange } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const source = page(8, 8);
    prescaler.setScaler('xbrz');
    frame(prescaler, [source]);
    contextChange.emit();
    frame(prescaler, [source]);
    expect(prescaledPageOf(source)).toBeDefined();
    contextChange.emit();
    expect(prescaler.stats()).toMatchObject({ scaler: 'xbrz', pages: 0, held: 'context losses' });
    expect(isCollectingDrawnPages()).toBe(false);
    frame(prescaler, [source]);
    expect(prescaledPageOf(source)).toBeUndefined();
    prescaler.setScaler('mmpx');
    expect(prescaler.stats().held).toBeNull();
    frame(prescaler, [source]);
    expect(prescaledPageOf(source)).toBeDefined();
  });

  it('holds under a recipe program the device did not link', () => {
    const { renderer, targets } = recordingRenderer({ linked: false });
    prescaler = new PagePrescaler(renderer, ROOMY);
    prescaler.setScaler('xbrz');
    expect(isCollectingDrawnPages()).toBe(false);
    frame(prescaler, [page(8, 8)]);
    expect(targets).toEqual([]);
    expect(prescaler.stats()).toMatchObject({
      scaler: 'xbrz',
      pages: 0,
      pending: 0,
      held: 'unlinked program',
    });
    prescaler.setScaler(null);
    expect(prescaler.stats().held).toBeNull();
  });

  it('keeps a page whose pass failed on the sharp path and goes on to the next page in the same frame', () => {
    const { renderer } = recordingRenderer({ refuse: 4 * PRESCALE_FACTOR });
    prescaler = new PagePrescaler(renderer, ROOMY);
    const [failing, fine] = [page(4, 4), page(8, 8)];
    prescaler.setScaler('xbrz');
    expect(() => frame(prescaler as PagePrescaler, [failing, fine])).not.toThrow();
    expect(prescaledPageOf(failing)).toBeUndefined();
    expect(prescaledPageOf(fine)).toBeDefined();
    expect(prescaler.stats()).toMatchObject({ pages: 1, pending: 0, failed: 1 });
    frame(prescaler, [failing]);
    expect(prescaler.stats()).toMatchObject({ pending: 0, failed: 1 });
    failing.destroy();
    expect(prescaler.stats().failed).toBe(0);
  });

  it('leaves a page whose twin would outgrow the device, and a page the cache does not hand over', () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const tall = page(8, MAX_TEXTURE_SIZE);
    const foreign = page(8, 8);
    prescaler.setScaler('xbrz');
    frame(prescaler, [tall, foreign], { isPrescalable: (source: TextureSource) => source !== foreign });
    expect(prescaler.stats()).toMatchObject({ pages: 0, oversized: 1, pending: 0 });
    tall.destroy();
    expect(prescaler.stats().oversized).toBe(0);
  });

  it('drops the twin of a page destroyed under it, and stops collecting with no scaler', () => {
    const { renderer } = recordingRenderer();
    prescaler = new PagePrescaler(renderer, ROOMY);
    const source = page(8, 8);
    prescaler.setScaler('mmpx');
    expect(isCollectingDrawnPages()).toBe(true);
    frame(prescaler, [source]);
    source.destroy();
    expect(prescaler.stats().pages).toBe(0);
    expect(hasPrescaledPages()).toBe(false);
    prescaler.setScaler(null);
    expect(isCollectingDrawnPages()).toBe(false);
  });
});
