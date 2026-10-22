import { describe, expect, it } from 'vitest';
import {
  type BobAtlasFrame,
  BobAtlasSet,
  bobAtlasManifest,
  bobAtlasSet,
  decodeAtlasFrames,
  encodeAtlasGeometry,
  servedBobAtlas,
} from '../src/index.js';

const FIRST_BOB = 10;

function frame(bobId: number, x: number, y: number, width: number, height: number, ox = 0, oy = 0) {
  return { bobId, rect: { x, y, width, height }, offsetX: ox, offsetY: oy } satisfies BobAtlasFrame;
}

/** A shelf of two frames, an empty bob, then a frame on the next shelf with negative offsets. */
const FRAMES = [
  frame(FIRST_BOB, 1, 1, 28, 53, -20, -45),
  frame(FIRST_BOB + 1, 30, 1, 30, 50, -20, -42),
  frame(FIRST_BOB + 2, 0, 0, 0, 0),
  frame(FIRST_BOB + 3, 1, 55, 12, 7, 3, -60),
];
const ATLAS = { width: 64, height: 64, frames: FRAMES };

describe('the atlas frame geometry', () => {
  it('decodes to the frames it was encoded from', () => {
    const geometry = encodeAtlasGeometry(ATLAS);
    expect(geometry).toMatchObject({ width: 64, height: 64, firstBobId: FIRST_BOB });
    expect(decodeAtlasFrames(geometry)).toEqual(FRAMES);
  });

  it('stores a shelf of like frames as small differences', () => {
    // The second frame starts one gutter right of the first and shares its row and offsetX.
    expect(encodeAtlasGeometry(ATLAS).frames.split(',').slice(6, 12)).toEqual([
      '1',
      '0',
      '2',
      '-3',
      '0',
      '3',
    ]);
  });

  it('round-trips an atlas with no bobs', () => {
    const geometry = encodeAtlasGeometry({ width: 0, height: 0, frames: [] });
    expect(decodeAtlasFrames(geometry)).toEqual([]);
  });

  it('rejects frames whose ids skip one', () => {
    expect(() =>
      encodeAtlasGeometry({ ...ATLAS, frames: [FRAMES[0], FRAMES[2]].flatMap((f) => f ?? []) }),
    ).toThrow(/breaks the id run/);
  });

  it.each(['1,2,3', '1,2,3,4,5,x', '1,2,3,4,5,', '1,2,3,4,5,-', '1,2,3,4,5,6 '])(
    'rejects the malformed frame list %j',
    (frames) => {
      expect(() => decodeAtlasFrames({ width: 1, height: 1, firstBobId: 0, frames })).toThrow(/atlas frames/);
    },
  );
});

describe('the served atlas document', () => {
  const geometry = encodeAtlasGeometry(ATLAS);
  const other = encodeAtlasGeometry({ ...ATLAS, width: 128 });
  const set = bobAtlasSet([
    [
      'body.wolf',
      { sheet: { image: 'b.png', palette: 'AAAA', imageEncoding: 'index-coverage-png' }, geometry },
    ],
    [
      'body.bear',
      { sheet: { image: 'b.png', palette: 'BBBB', imageEncoding: 'index-coverage-png' }, geometry },
    ],
    ['house.red', { sheet: { image: 'h.webp', buildImage: 't.webp' }, geometry: other }],
  ]);

  it('stores a geometry the recolours share once, stems in code-unit order', () => {
    expect(set.geometries).toHaveLength(2);
    expect(Object.keys(set.stems)).toEqual(['body.bear', 'body.wolf', 'house.red']);
    expect(set.stems['body.bear']?.geometry).toBe(set.stems['body.wolf']?.geometry);
    expect(BobAtlasSet.parse(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });

  it('expands a stem to its manifest and leaves an unserved one undefined', () => {
    expect(bobAtlasManifest(set, 'house.red')).toEqual({
      image: 'h.webp',
      buildImage: 't.webp',
      width: 128,
      height: 64,
      frames: FRAMES,
    });
    expect(servedBobAtlas(set, 'body.bear')?.sheet.palette).toBe('BBBB');
    expect(bobAtlasManifest(set, 'house.blue')).toBeUndefined();
    expect(bobAtlasManifest(set, '__proto__')).toBeUndefined();
  });

  it('rejects a stem naming no geometry or a palette without its encoding', () => {
    const stray = { ...set, stems: { ...set.stems, lost: { geometry: 2, image: 'x.webp' } } };
    expect(BobAtlasSet.safeParse(stray).success).toBe(false);
    const bare = { ...set, stems: { lone: { geometry: 0, image: 'x.png', palette: 'AAAA' } } };
    expect(BobAtlasSet.safeParse(bare).success).toBe(false);
  });
});
