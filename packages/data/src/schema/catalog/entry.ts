import { z } from 'zod';
import { CatalogConversion } from './conversion.js';
import { CATALOG_MAP_ID } from './id.js';

/** How the upstream catalogue groups maps, as `/v1/catalog` names the groups. */
export const CatalogCategory = z.enum(['single', 'multi', 'campaign', 'series-single', 'series-multi']);
export type CatalogCategory = z.infer<typeof CatalogCategory>;

/** Where a catalogue map's download lives. */
export const CatalogFile = z.discriminatedUnion('kind', [
  /** An archive on the catalogue's own host, which the API may fetch and unpack. */
  z.strictObject({ kind: z.literal('archive') }),
  /** A bare `.c2m` map file on the catalogue's own host. */
  z.strictObject({ kind: z.literal('c2m') }),
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
  category: CatalogCategory,
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
