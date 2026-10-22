import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeGreyAlphaPng, decodePng, encodeGreyAlphaPng, encodePng } from '../src/png.js';

/**
 * PNG container tests. No fixtures are committed: we synthesize RGBA in memory, encode it, and assert
 * `decodePng` recovers dimensions and pixels byte-for-byte. A handful of cases hand-build PNG bytes (with
 * an independent CRC-32, so the decoder is checked against a separate implementation) to exercise the
 * signature/CRC guards and every row filter.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A `width*height` RGBA gradient: R=x, G=y, B=x+y, A ramps so every channel varies. */
const gradient = (width: number, height: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = x & 0xff;
      rgba[o + 1] = y & 0xff;
      rgba[o + 2] = (x + y) & 0xff;
      rgba[o + 3] = (o * 3) & 0xff;
    }
  }
  return rgba;
};

// Independent CRC-32 + chunk assembler for the hand-built cases (deliberately NOT the module's).
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};

const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
};

/** Filters one scanline per the PNG spec's five filter types; an independent copy of the predictors. */
const filterRow = (row: Uint8Array, prev: Uint8Array | null, bpp: number, filter: number): Uint8Array => {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? (row[i - bpp] ?? 0) : 0;
    const b = prev?.[i] ?? 0;
    const c = i >= bpp ? (prev?.[i - bpp] ?? 0) : 0;
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    const predicted = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0;
    out[i] = ((row[i] ?? 0) - predicted) & 0xff;
  }
  return out;
};

/** Builds an 8-bit PNG of `colorType` whose row `y` uses `filters[y % filters.length]`. */
const makePngWithFilters = (
  width: number,
  height: number,
  pixels: Uint8Array,
  colorType: number,
  filters: readonly number[],
): Uint8Array => {
  const bpp = colorType === 4 ? 2 : 4;
  const stride = width * bpp;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length] ?? 0;
    const row = pixels.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    raw[y * (stride + 1)] = filter;
    raw.set(filter > 4 ? row : filterRow(row, prev, bpp, filter), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width, false);
  hv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [
    Uint8Array.from(SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', new Uint8Array(deflateSync(raw))),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
};

/** Grey + alpha pixels where both channels vary across rows and columns. */
const greyAlpha = (width: number, height: number): Uint8Array =>
  Uint8Array.from({ length: width * height * 2 }, (_, i) => (i * 37 + (i >> 3) * 11) & 0xff);

/** Every filter type the spec defines: None, Sub, Up, Average, Paeth. */
const ALL_FILTERS = [0, 1, 2, 3, 4];

describe('encodePng / decodePng', () => {
  it('round-trips dimensions and RGBA pixels', async () => {
    const width = 7;
    const height = 5;
    const rgba = gradient(width, height);
    const decoded = await decodePng(await encodePng({ width, height, rgba }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.rgba).toEqual(rgba);
  });

  it('round-trips a 1x1 image and emits the PNG signature', async () => {
    const png = await encodePng({ width: 1, height: 1, rgba: Uint8Array.from([10, 20, 30, 40]) });
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    expect((await decodePng(png)).rgba).toEqual(Uint8Array.from([10, 20, 30, 40]));
  });

  it('decodes a hand-built PNG of every row filter (independent CRC) identically', async () => {
    const rgba = gradient(6, 10);
    for (const filter of ALL_FILTERS) {
      expect(await decodePng(makePngWithFilters(6, 10, rgba, 6, [filter]))).toEqual({
        width: 6,
        height: 10,
        rgba,
      });
    }
    expect(await decodePng(makePngWithFilters(6, 10, rgba, 6, ALL_FILTERS))).toEqual({
      width: 6,
      height: 10,
      rgba,
    });
  });

  it('takes a caller-supplied compressor', async () => {
    const rgba = gradient(3, 3);
    const png = await encodePng(
      { width: 3, height: 3, rgba },
      { deflate: async (bytes) => new Uint8Array(deflateSync(bytes, { level: 9 })) },
    );
    expect((await decodePng(png)).rgba).toEqual(rgba);
  });
});

describe('encodeGreyAlphaPng / decodeGreyAlphaPng', () => {
  it('round-trips grey + alpha pixels as colour type 4', async () => {
    const pixels = greyAlpha(9, 4);
    const png = await encodeGreyAlphaPng({ width: 9, height: 4, pixels });
    expect(png[25]).toBe(4); // IHDR colour type: signature(8) + len(4) + type(4) + width/height(8) + depth(1)
    expect(await decodeGreyAlphaPng(png)).toEqual({ width: 9, height: 4, pixels });
  });

  it('decodes rows under each of the five filters, mixed within one image', async () => {
    const pixels = greyAlpha(7, 11);
    for (const filter of ALL_FILTERS) {
      expect((await decodeGreyAlphaPng(makePngWithFilters(7, 11, pixels, 4, [filter]))).pixels).toEqual(
        pixels,
      );
    }
    expect((await decodeGreyAlphaPng(makePngWithFilters(7, 11, pixels, 4, ALL_FILTERS))).pixels).toEqual(
      pixels,
    );
  });

  it('rejects a PNG of another colour type', async () => {
    const png = await encodePng({ width: 1, height: 1, rgba: Uint8Array.from([1, 2, 3, 4]) });
    await expect(decodeGreyAlphaPng(png)).rejects.toThrow(/colorType=6/);
    await expect(
      decodePng(await encodeGreyAlphaPng({ width: 1, height: 1, pixels: Uint8Array.from([1, 2]) })),
    ).rejects.toThrow(/colorType=4/);
  });
});

describe('encodePng guards', () => {
  it('rejects an rgba buffer whose length disagrees with the dimensions', async () => {
    await expect(encodePng({ width: 2, height: 2, rgba: new Uint8Array(8) })).rejects.toThrow(
      /does not match 2x2x4/,
    );
  });

  it('rejects non-positive dimensions', async () => {
    await expect(encodePng({ width: 0, height: 4, rgba: new Uint8Array(0) })).rejects.toThrow(
      /invalid dimensions 0x4/,
    );
  });
});

describe('decodePng guards', () => {
  it('throws on a buffer without the PNG signature', async () => {
    await expect(decodePng(new Uint8Array(8))).rejects.toThrow(/bad signature/);
  });

  it('throws a CRC mismatch when a chunk byte is corrupted', async () => {
    const png = await encodePng({ width: 2, height: 2, rgba: gradient(2, 2) });
    png[41] = (png[41] ?? 0) ^ 0xff; // first IDAT data byte: signature(8) + IHDR chunk(25) + len(4) + type(4)
    await expect(decodePng(png)).rejects.toThrow(/CRC mismatch in IDAT/);
  });

  it('rejects a row filter the spec does not define', async () => {
    const png = makePngWithFilters(3, 2, gradient(3, 2), 6, [5]);
    await expect(decodePng(png)).rejects.toThrow(/unknown row filter 5/);
  });
});
