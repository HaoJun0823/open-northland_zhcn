import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AtlasSheetRef } from '../../../src/content/atlas-sheet/index.js';
import { bobAtlasDocument } from '../../support/bob-atlases.js';

/**
 * Palette twins (`ls_trees.tree01`, `ls_trees.tree02`, ...) name one indexed sheet and one geometry and
 * differ only by palette, so they draw from one recoloured page, each through its own palette. The
 * renderer's texture caches key a view by the atlas frame object, so twins must not share frames: a
 * shared frame hands every twin the palette of whichever stem drew it first.
 */

/** One page per sheet, as the loader shares a recoloured page between a bob set's recolours. */
vi.mock('../../../src/content/atlas-sheet/index.js', async () => {
  const { RecolouredPageSource } = await import('@open-northland/render');
  const pages = new Map<string, InstanceType<typeof RecolouredPageSource>>();
  return {
    loadAtlasSheet: (sheet: AtlasSheetRef) => {
      let page = pages.get(sheet.image);
      if (page === undefined) {
        page = new RecolouredPageSource(new Uint8Array(8 * 8 * 2), 8, 8);
        pages.set(sheet.image, page);
      }
      return Promise.resolve(page);
    },
  };
});

const COLD_TRANSFORM_TIMEOUT_MS = 180_000;

const SHEET = '0123456789abcdef.png';
const FRAME = { bobId: 1, rect: { x: 0, y: 0, width: 4, height: 4 } };
const twin = (palette: string) =>
  ({
    width: 8,
    height: 8,
    frames: [FRAME],
    image: SHEET,
    palette,
    imageEncoding: 'index-coverage-png',
  }) as const;
const paletteOf = (value: number): string =>
  btoa(String.fromCharCode(...new Uint8Array(256 * 3).fill(value)));
const PALETTE_A = paletteOf(1);
const PALETTE_B = paletteOf(2);

// Modules are shared across test files, so the loader is re-evaluated here to pick up the mock above.
vi.resetModules();

beforeAll(async () => {
  await import('../../../src/content/ir/load.js');
}, COLD_TRANSFORM_TIMEOUT_MS);

describe('palette twins', () => {
  it('draw both twins from one page, each through frames of its own that name its palette', async () => {
    const document = bobAtlasDocument({
      'ls_trees.tree01': twin(PALETTE_A),
      'ls_trees.tree02': twin(PALETTE_B),
    });
    expect(document.geometries).toHaveLength(1); // the pipeline's shape: twins share one geometry
    vi.stubGlobal('fetch', (() => Promise.resolve(new Response(JSON.stringify(document)))) as typeof fetch);
    const { loadLayer } = await import('../../../src/content/ir/load.js');
    const { recolourOf, TextureCache } = await import('@open-northland/render');

    const [a, b] = await Promise.all([loadLayer('ls_trees.tree01'), loadLayer('ls_trees.tree02')]);
    const frameA = a.atlas.frames.get(FRAME.bobId);
    const frameB = b.atlas.frames.get(FRAME.bobId);
    if (frameA === undefined || frameB === undefined) throw new Error('twin frame not indexed');
    const cache = new TextureCache();

    expect(a.source).toBe(b.source);
    expect(frameA).not.toBe(frameB);
    expect(recolourOf(frameA)?.[0]).toBe(1);
    expect(recolourOf(frameB)?.[0]).toBe(2);
    expect(cache.get(a.source, frameA)).not.toBe(cache.get(b.source, frameB));
    vi.unstubAllGlobals();
  });
});
