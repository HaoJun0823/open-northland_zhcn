import { z } from 'zod';
import { LANGUAGES, SOURCE_LANGUAGES } from '../../languages.js';

/**
 * The repository's translation overlays, `translations/<lang>/...`: text the data pack and the
 * catalogue archives do not carry. An overlay entry replaces the source entry of the same key; a key
 * the overlay lacks falls back to the source text of that language, else to the language the overlay
 * was written against. Overlays are UTF-8 JSON validated by these schemas before any stage reads them.
 */
export const OVERLAY_VERSION = 1;

/** A SHA-256 hex digest. */
const Digest = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The source text the overlay was written against: the language it translates or edits, and the
 * digest of that language's decoded text as the pack shipped it. A later source change under an
 * unchanged overlay is reported by the translations audit, never silently masked nor a build failure.
 */
export const OverlayBasis = z.strictObject({
  lang: z.enum(SOURCE_LANGUAGES),
  digest: Digest,
});
export type OverlayBasis = z.infer<typeof OverlayBasis>;

/** `translations/<lang>/maps/<map.dat SHA-256>.json`: one map's strings by id and briefing blocks by label. */
export const MapOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  /** The map id the overlay was written for, for readers; the file name is the identity. */
  map: z.string().min(1),
  basis: OverlayBasis,
  strings: z.record(z.string().regex(/^\d+$/), z.string()).default({}),
  /** `briefings.txt` block bodies by label, with the tags a block body carries (`<picture:…>` and so on). */
  briefings: z.record(z.string().min(1), z.string()).default({}),
});
export type MapOverlay = z.infer<typeof MapOverlay>;

/**
 * `translations/<lang>/objects/<table>.json`: one game-object name table (`goods`, `houses`, `jobs`,
 * `experiences`, `tribes`) by type id, with the plural where the table has one.
 */
export const ObjectTableOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  basis: OverlayBasis,
  names: z.record(z.string().regex(/^\d+$/), z.string()),
  plurals: z.record(z.string().regex(/^\d+$/), z.string()).default({}),
});
export type ObjectTableOverlay = z.infer<typeof ObjectTableOverlay>;

/**
 * `translations/<lang>/books/<book>.json`: a hypertext book's block bodies, by block file then label
 * (`history.txt`, `mythology.txt`); the pages come from the basis language.
 */
export const BookOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  basis: OverlayBasis,
  blocks: z.record(z.string().min(1), z.record(z.string().min(1), z.string())),
});
export type BookOverlay = z.infer<typeof BookOverlay>;

/** `translations/<lang>/campaigns/<campaign-id>.json`: the campaign screen's title. */
export const CampaignOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  title: z.string().min(1),
});
export type CampaignOverlay = z.infer<typeof CampaignOverlay>;

export const OverlayLanguageCode = z.enum(LANGUAGES);
