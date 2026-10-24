import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tribeEmblemRows } from '../../src/content/building-gfx/emblems.js';
import type { GoodsManifest } from '../../src/content/goods-gfx.js';
import { servedAtlasStem } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { spriteGoodIcon, swarmFishIcon } from '../../src/content/sprite-good-icons.js';
import {
  contentDir,
  hasRealIr,
  loadContentUnderTest,
  rawIrUnderTest,
  servedAtlasManifest,
} from './helpers.js';

/** A `fetch` serving the content tree under test at its content paths. */
const serveContentFetch: typeof fetch = (input) => {
  const path = resolve(contentDir(), `.${String(input)}`);
  return Promise.resolve(
    existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }),
  );
};

function manifestOf(stem: string): { readonly palette?: string } | null {
  return servedAtlasManifest(stem) ?? null;
}

/**
 * Every stem the DOM shows as an `<img>` or a CSS background (the goods' icons, the tribe emblems) is
 * served as an RGBA sheet: such a picture reads the pixels as they are, so a paletted sheet would show
 * palette indices. The pipeline derives those stems from the IR (`domPictureStems`); this checks that
 * derivation against the app's own joins.
 */
describe.runIf(hasRealIr())('DOM picture sheets on real content', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', serveContentFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('serves every stem a good icon or a tribe emblem reads in colour', async () => {
    const stems = new Set<string>();
    const goods = JSON.parse(
      readFileSync(resolve(contentDir(), 'goods', 'manifest.json'), 'utf8'),
    ) as GoodsManifest;
    const pileBase = goods.previewStem.replace(/\.[^.]+$/, '');
    for (const icon of Object.values(goods.icons)) stems.add(`${pileBase}.${icon.palette}`);
    const { real } = await loadContentUnderTest();
    for (const good of real.goods) {
      for (const icon of [await spriteGoodIcon(real, good.id), await swarmFishIcon(real, good.id)])
        if (icon !== null) stems.add(icon.stem);
    }
    for (const row of tribeEmblemRows(rawIrUnderTest() as ContentIr, CIVILIZATION_TRIBES).values()) {
      const stem = servedAtlasStem(row);
      if (stem !== undefined) stems.add(stem);
    }

    const served = [...stems].filter((stem) => manifestOf(stem) !== null);
    expect(served.length).toBeGreaterThan(0);
    expect(served.filter((stem) => manifestOf(stem)?.palette !== undefined)).toEqual([]);
  });
});
