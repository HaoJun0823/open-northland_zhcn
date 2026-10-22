import type { RgbaImage } from '@open-northland/formats/image';
import { describe, expect, it } from 'vitest';
import { ATLAS_IMAGE_EXTENSION, atlasImageName, encodeAtlasImage } from '../src/stages/atlas-image.js';
import { decodeAtlasImage } from './support/served-atlas.js';

/** A 4x2 sheet holding what an indexed sheet relies on: colour under zero alpha, graded alpha, opaque. */
const SHEET: RgbaImage = {
  width: 4,
  height: 2,
  rgba: Uint8Array.from(
    [
      [17, 200, 3, 0],
      [255, 255, 255, 0],
      [90, 0, 140, 0x40],
      [1, 2, 3, 255],
      [0, 0, 0, 0],
      [250, 10, 77, 0],
      [128, 128, 128, 1],
      [64, 32, 16, 254],
    ].flat(),
  ),
};

describe('encodeAtlasImage', () => {
  it('round-trips every byte, the RGB under transparent pixels included', async () => {
    const decoded = await decodeAtlasImage(await encodeAtlasImage(SHEET));
    expect([decoded.width, decoded.height]).toEqual([SHEET.width, SHEET.height]);
    expect([...decoded.rgba]).toEqual([...SHEET.rgba]);
  });
});

describe('atlasImageName', () => {
  it('names identical sheets alike and different sheets apart', () => {
    const copy: RgbaImage = { ...SHEET, rgba: SHEET.rgba.slice() };
    const name = atlasImageName(SHEET);
    expect(name).toMatch(new RegExp(`^[0-9a-f]{16}\\${ATLAS_IMAGE_EXTENSION}$`));
    expect(atlasImageName(copy)).toBe(name);
    // The same bytes in another shape are another sheet.
    expect(atlasImageName({ ...SHEET, width: 2, height: 4 })).not.toBe(name);
  });
});
