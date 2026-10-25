import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOB_ATLASES_PATH, type BobAtlasSet } from '@open-northland/data';
import {
  colourIndexedSheet,
  decodeAtlasPalette,
  GREY_ALPHA_INDEXED,
} from '@open-northland/formats/atlas/paletted-sheet';
import { decodeGreyAlphaPng } from '@open-northland/formats/png';
import { colourRecolouredFrame, RecolouredPageSource } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { recolourRows } from '../../../src/content/sprite-sheet/human-palettes.js';
import { contentDir, hasRealIr } from '../helpers.js';

const RGBA = 4;
/** Every sheet decoded and every stem coloured twice takes a while on the whole pack. */
const WHOLE_PACK_TIMEOUT_MS = 300_000;

/**
 * The CPU colouring of a recoloured frame (what the readers and colour copies get) equals the whole-sheet
 * colouring an RGBA page of the stem is made from, before any premultiply, for every paletted stem of the
 * pack. It checks neither createImageBitmap nor the shaders.
 */
describe.runIf(hasRealIr())('recoloured pages on real content', () => {
  const set = JSON.parse(readFileSync(resolve(contentDir(), BOB_ATLASES_PATH), 'utf8')) as BobAtlasSet;
  const bySheet = new Map<string, string[]>();
  for (const entry of Object.values(set.stems)) {
    if (entry.palette === undefined) continue;
    bySheet.set(entry.image, [...(bySheet.get(entry.image) ?? []), entry.palette]);
  }

  it('reserve a LUT row for every paletted stem of the pack, with headroom', () => {
    expect(recolourRows(set)).toBeGreaterThan([...bySheet.values()].flat().length);
  });

  it(
    'colour every stem texel for texel as the whole-sheet colouring',
    async () => {
      let differing = 0;
      for (const [image, palettes] of bySheet) {
        const sheet = await decodeGreyAlphaPng(
          new Uint8Array(readFileSync(resolve(contentDir(), 'bobs', image))),
        );
        const page = new RecolouredPageSource(sheet.pixels, sheet.width, sheet.height);
        const whole = { x: 0, y: 0, width: sheet.width, height: sheet.height };
        const coloured = new Uint8Array(sheet.width * sheet.height * RGBA);
        const drawn = new Uint8Array(coloured.length);
        for (const base64 of palettes) {
          const palette = decodeAtlasPalette(base64);
          colourIndexedSheet(sheet.pixels, GREY_ALPHA_INDEXED, palette, coloured);
          colourRecolouredFrame(page, whole, palette, drawn);
          for (let i = 0; i < coloured.length; i++) if (coloured[i] !== drawn[i]) differing++;
        }
      }
      expect(differing).toBe(0);
    },
    WHOLE_PACK_TIMEOUT_MS,
  );
});
