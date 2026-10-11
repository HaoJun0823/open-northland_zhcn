import { z } from 'zod';
import { MAP_FINGERPRINT, MapsIndexEntry } from '../maps/listing.js';
import { MAP_TEXT_LANGUAGES } from '../maps/strings.js';
import { CATALOG_MAP_ID } from './id.js';

/** One map the API converted out of a catalogue entry: a campaign pack yields its main map and its
 *  sub-mission maps, each served under its own `mapId` at `/v1/content/<irVersion>/maps/<mapId>.*`. */
export const CatalogConvertedMap = z.strictObject({
  mapId: z.string().regex(CATALOG_MAP_ID),
  /** The lower-cased archive folder slug the map came from, without the `-2`, `-3` repeat suffix the
   *  `mapId` may carry; a shipped map's id is its mod folder slug, so the two compare directly. */
  folder: z.string().min(1),
  /** Equals `index.fingerprint`, kept here for the client's install check. */
  fingerprint: z.string().regex(MAP_FINGERPRINT),
  /** The languages the map's own string table carries; the client falls back along
   *  `MAP_TEXT_LANGUAGES` for the rest. */
  languages: z.array(z.enum(MAP_TEXT_LANGUAGES)),
  /** The terrain grid in cells, for size filters without fetching the terrain. */
  cells: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
  /** The row the map would have in `maps-index.json`, so the client lists it without a second fetch. */
  index: MapsIndexEntry,
});
export type CatalogConvertedMap = z.infer<typeof CatalogConvertedMap>;

/** Why an entry has no playable maps; the server-side `MapImportError` kinds plus a failed download. */
export const CatalogConversionFailure = z.enum([
  'no-map',
  'too-large',
  'unsupported-archive',
  'decode-failed',
  'download-failed',
]);
export type CatalogConversionFailure = z.infer<typeof CatalogConversionFailure>;

/** What the API made of an entry's file. Absent on an `external` entry, which has no file to convert. */
export const CatalogConversion = z.discriminatedUnion('verdict', [
  z.strictObject({
    verdict: z.literal('ok'),
    /** The `IR_VERSION` the sidecars were produced with; a client on another version re-fetches
     *  after the API redeploys, never translates. */
    irVersion: z.number().int().positive(),
    maps: z.array(CatalogConvertedMap).min(1),
  }),
  /** Queued or running; the client shows the entry without a download button. */
  z.strictObject({ verdict: z.literal('pending') }),
  z.strictObject({
    verdict: z.literal('failed'),
    reason: CatalogConversionFailure,
    /** The decoder's or downloader's own message, for the entry's detail view. */
    message: z.string(),
  }),
]);
export type CatalogConversion = z.infer<typeof CatalogConversion>;
