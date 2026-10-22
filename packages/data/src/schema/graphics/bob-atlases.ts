import { z } from 'zod';

/** The served document holding every bob atlas stem's manifest, under the content root. */
export const BOB_ATLASES_PATH = 'bobs/atlases.json';

const Count = z.number().int().nonnegative();

/**
 * One frame placement shared by the stems that cut the same bob set: a bob set's palette recolours
 * differ only in their sheet and palette. `frames` is decoded by `decodeAtlasFrames`, which owns the
 * encoding; it stays one string because a parsed number array of every bob set costs about four times
 * its text in heap.
 */
export const BobAtlasGeometry = z.strictObject({
  width: Count,
  height: Count,
  /** The bob id of the first frame; the rest follow in id order. */
  firstBobId: Count,
  frames: z.string(),
});
export type BobAtlasGeometry = z.infer<typeof BobAtlasGeometry>;

/** One stem: the sheet its frames are cut from and how that sheet is coloured. */
export const BobAtlasStem = z.strictObject({
  /** Index into {@link BobAtlasSet} `geometries`. */
  geometry: Count,
  /** The sheet's file name under `bobs/`; stems with byte-identical sheets name the same file. */
  image: z.string().min(1),
  /** This stem's 256 RGB entries, base64, when `image` is an indexed sheet shared by the bob set's
   *  recolours. */
  palette: z.string().min(1).exactOptional(),
  /** How a paletted `image` is stored; present with `palette`. */
  imageEncoding: z.literal('index-coverage-png').exactOptional(),
  /** The `'build-time'` bake's time sheet, placed like `image`. */
  buildImage: z.string().min(1).exactOptional(),
});
export type BobAtlasStem = z.infer<typeof BobAtlasStem>;

/** The whole `bobs/atlases.json`. */
export const BobAtlasSet = z
  .strictObject({
    geometries: z.array(BobAtlasGeometry),
    stems: z.record(z.string().min(1), BobAtlasStem),
  })
  .superRefine((set, ctx) => {
    for (const [stem, entry] of Object.entries(set.stems)) {
      if (entry.geometry >= set.geometries.length) {
        ctx.addIssue({ code: 'custom', path: ['stems', stem, 'geometry'], message: 'no such geometry' });
      }
      if ((entry.palette === undefined) !== (entry.imageEncoding === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stems', stem],
          message: 'palette and imageEncoding go together',
        });
      }
    }
  });
export type BobAtlasSet = z.infer<typeof BobAtlasSet>;
