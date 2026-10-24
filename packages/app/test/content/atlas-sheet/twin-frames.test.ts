import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AtlasSheetRef } from '../../../src/content/atlas-sheet/index.js';
import { bobAtlasDocument } from '../../support/bob-atlases.js';

/**
 * Palette twins (`ls_trees.tree01`, `ls_trees.tree02`, ...) name one indexed sheet and one geometry and
 * differ only by palette, so each draws from its own coloured page. The renderer's texture caches key a
 * view by the atlas frame object, so twins must not share frames: a shared frame hands every twin the
 * page of whichever stem drew it first.
 */

/** One distinct page per colouring the loader asks for, as the colouring workers hand back. */
vi.mock('../../../src/content/atlas-sheet/index.js', async () => {
  const { TextureSource } = await import('pixi.js');
  return {
    loadAtlasSheet: (sheet: AtlasSheetRef) =>
      Promise.resolve(new TextureSource({ label: `${sheet.image}:${sheet.palette ?? 'rgb'}` })),
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
const PALETTE_A = 'palette-a';
const PALETTE_B = 'palette-b';

// Modules are shared across test files, so the loader is re-evaluated here to pick up the mock above.
vi.resetModules();

beforeAll(async () => {
  await import('../../../src/content/ir/load.js');
}, COLD_TRANSFORM_TIMEOUT_MS);

describe('palette twins', () => {
  it('draw each twin from its own page, through frames no other page shares', async () => {
    const document = bobAtlasDocument({
      'ls_trees.tree01': twin(PALETTE_A),
      'ls_trees.tree02': twin(PALETTE_B),
    });
    expect(document.geometries).toHaveLength(1); // the pipeline's shape: twins share one geometry
    vi.stubGlobal('fetch', (() => Promise.resolve(new Response(JSON.stringify(document)))) as typeof fetch);
    const { loadLayer } = await import('../../../src/content/ir/load.js');
    const { TextureCache } = await import('@open-northland/render');

    const [a, b] = await Promise.all([loadLayer('ls_trees.tree01'), loadLayer('ls_trees.tree02')]);
    const frameA = a.atlas.frames.get(FRAME.bobId);
    const frameB = b.atlas.frames.get(FRAME.bobId);
    if (frameA === undefined || frameB === undefined) throw new Error('twin frame not indexed');
    const cache = new TextureCache();

    expect(a.source).not.toBe(b.source);
    expect(cache.get(a.source, frameA).source).toBe(a.source);
    expect(cache.get(b.source, frameB).source).toBe(b.source);
    vi.unstubAllGlobals();
  });
});
