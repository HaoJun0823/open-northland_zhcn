import { z } from 'zod';
import { CatalogConversion } from './conversion.js';
import { CATALOG_MAP_ID } from './id.js';

/** What an entry is for, read out of the upstream's free-text category by keyword. `other` lists a
 *  category the keywords do not place; the client then shows `categoryLabel` alone. */
export const CatalogKind = z.enum(['single', 'multi', 'campaign', 'other']);
export type CatalogKind = z.infer<typeof CatalogKind>;

/** What the API knows about a file it fetched; both absent until it has. */
const keptFile = {
  /** The downloaded size. */
  bytes: z.number().int().nonnegative().optional(),
  /** Our `/v1/maps/<id>/file` path serving the file as downloaded, for a player to unpack by hand
   *  when the API could not. */
  path: z.string().startsWith('/v1/maps/').optional(),
};

/** Where a catalogue map's download lives. */
export const CatalogFile = z.discriminatedUnion('kind', [
  /** An archive on the catalogue's own host, which the API fetches and unpacks. */
  z.strictObject({ kind: z.literal('archive'), ...keptFile }),
  /** A bare `.c2m` map file on the catalogue's own host. */
  z.strictObject({ kind: z.literal('c2m'), ...keptFile }),
  /** A page on another host. The URL is only a link for a person to open: nothing proves it leads
   *  straight to a file. */
  z.strictObject({ kind: z.literal('external'), url: z.url() }),
]);
export type CatalogFile = z.infer<typeof CatalogFile>;

/** One `/v1/catalog` entry: an accepted culturesnation.pl map, normalized by the API. */
export const CatalogEntry = z.strictObject({
  id: z.string().regex(CATALOG_MAP_ID),
  source: z.strictObject({
    /** The upstream record's stable key, which our `id` derives from. */
    documentId: z.string().min(1),
    /** The upstream numeric id, which may change when a record is re-created. */
    id: z.number().int().nonnegative(),
    /** The catalogue page a player opens to see the map's author and listing. */
    page: z.url(),
  }),
  title: z.string(),
  shortDescription: z.string(),
  fullDescription: z.string(),
  author: z.string(),
  kind: CatalogKind,
  /** Whether the upstream files the entry under its "maps from the Cultures series" categories. */
  series: z.boolean(),
  /** The upstream category text as written, for display beside `kind`. */
  categoryLabel: z.string(),
  publishedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  downloadCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  /** The author's free-text version, with the free-text file size beside it when both are given.
   *  Shown as written; nothing reads a number out of it. Absent when the author gave no version. */
  versionText: z.string().min(1).optional(),
  /** Our `/v1/maps/<id>/thumbnail` path, relative to the API origin. Absent when the upstream has no
   *  screenshot or it could not be fetched. */
  thumbnail: z.string().startsWith('/v1/maps/').optional(),
  file: CatalogFile,
  /** The server-side conversion of `file`; absent until the API has looked at the file, and on an
   *  `external` entry. */
  conversion: CatalogConversion.optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/** The whole `/v1/catalog` body: every entry, sorted by id. */
export const Catalog = z.array(CatalogEntry);
export type Catalog = z.infer<typeof Catalog>;
