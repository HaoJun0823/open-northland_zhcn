import { encodePcx } from '@open-northland/formats/pcx';
import { decodePng } from '@open-northland/formats/png';
import { describe, expect, it } from 'vitest';
import { rampPalette } from '../../formats/test/fixtures/palette.js';
import { minimapToPng } from '../src/minimap.js';

describe('minimapToPng', () => {
  // The filler is keyed by palette INDEX 0 (its RGB varies across the corpus - magenta, blue, brown),
  // so the fixtures only need index 0 as the frame; rampPalette's entry 0 = (0, 255, 0), a pure
  // colour, stands in for a colour-key filler.

  /** rampPalette with entry 0 set to a painting brown, the non-key filler two shipped pictures use. */
  const paintedFillerPalette = (): Uint8Array => {
    const palette = rampPalette();
    palette.set([180, 120, 87], 0);
    return palette;
  };

  /** A 5×5 index-0 frame around a ring of real pixels with an enclosed index-0 hole in the middle. */
  // biome-ignore format: the grid reads as the picture
  const holedRing = Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 0, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ]);

  it('keys the border-connected index-0 filler transparent and crops to the real map pixels', async () => {
    // A 4×2 canvas whose real pixels occupy the middle 2×1 (indices 1/2); the rest is index-0 filler.
    const pcx = encodePcx({
      width: 4,
      height: 2,
      pixels: Uint8Array.from([0, 0, 0, 0, 0, 1, 2, 0]),
      palette: rampPalette(),
    });
    const png = await decodePng(await minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 2, height: 1 });
    // rampPalette entry 1 = (1, 254, 7), entry 2 = (2, 253, 14), both fully opaque after the crop.
    expect(Array.from(png.rgba)).toEqual([1, 254, 7, 255, 2, 253, 14, 255]);
  });

  it('keys an enclosed colour-key filler speck to transparent black', async () => {
    // The magenta specks a dissolved picture edge leaves inside the picture: index 0 with a pure
    // colour is filler wherever it occurs.
    const pcx = encodePcx({ width: 5, height: 5, pixels: holedRing, palette: rampPalette() });
    const png = await decodePng(await minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 3, height: 3 });
    const center = (1 * 3 + 1) * 4;
    expect(Array.from(png.rgba.subarray(center, center + 4))).toEqual([0, 0, 0, 0]);
    expect(png.rgba[(0 * 3 + 0) * 4 + 3]).toBe(255); // the real ring survives
  });

  it('keeps an enclosed index-0 pixel opaque when the filler colour also paints the scene', async () => {
    const pcx = encodePcx({ width: 5, height: 5, pixels: holedRing, palette: paintedFillerPalette() });
    const png = await decodePng(await minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 3, height: 3 });
    const center = (1 * 3 + 1) * 4;
    expect(Array.from(png.rgba.subarray(center, center + 4))).toEqual([180, 120, 87, 255]);
  });

  it('keys a ragged filler intrusion inside the crop box to alpha 0', async () => {
    // The filler bites into the picture's bounding box (BLEKINY_NURT-style ragged edge): (1,0) is
    // index 0 connected to the frame, inside the crop - transparent, while the columns stay.
    const pcx = encodePcx({
      width: 4,
      height: 3,
      // biome-ignore format: the grid reads as the picture
      pixels: Uint8Array.from([
        0, 0, 0, 0,
        0, 1, 0, 2,
        0, 1, 2, 2,
      ]),
      palette: rampPalette(),
    });
    const png = await decodePng(await minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 3, height: 2 });
    expect(png.rgba[(0 * 3 + 1) * 4 + 3]).toBe(0); // the intruding filler pixel, transparent
    expect(png.rgba[(1 * 3 + 1) * 4 + 3]).toBe(255); // the real pixel below it, opaque
  });

  it('throws on an all-filler picture (nothing to crop to)', async () => {
    const pcx = encodePcx({
      width: 2,
      height: 1,
      pixels: Uint8Array.from([0, 0]),
      palette: rampPalette(),
    });
    await expect(minimapToPng(pcx)).rejects.toThrow(/filler/);
  });
});
