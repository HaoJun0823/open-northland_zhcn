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
/** A string id or type id as its decimal key, without leading zeros, so it names the id it parses to. */
const IdKey = z.string().regex(/^(0|[1-9]\d*)$/);

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

/**
 * `translations/<lang>/maps/<map.dat SHA-256>.json`: one map's strings by id and briefing blocks by label.
 * A further overlay of the same `map.dat` and language, for a copy of the map with other text, is
 * `<map.dat SHA-256>.<first hex digits of basis.digest>.json`.
 */
export const MapOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  /** The map id the overlay was written for, for readers; the file name and basis are the identity. */
  map: z.string().min(1),
  basis: OverlayBasis,
  strings: z.record(IdKey, z.string()).default({}),
  /** `briefings.txt` block bodies by label, with the tags a block body carries (`<picture:…>` and so on). */
  briefings: z.record(z.string().min(1), z.string()).default({}),
  /** Set on a file a tool converted from the named language's overlay of the same name (Traditional
   *  from Simplified Chinese); the tool rewrites it and nobody edits it by hand. */
  derived: z.enum(LANGUAGES).optional(),
});
export type MapOverlay = z.infer<typeof MapOverlay>;

/** How many leading hex digits of `basis.digest` a further map overlay's file name carries. */
export const MAP_OVERLAY_BASIS_PREFIX_LENGTH = 12;
const MAP_OVERLAY_FILE_ID = new RegExp(
  `^([0-9a-f]{64})(?:\\.([0-9a-f]{${MAP_OVERLAY_BASIS_PREFIX_LENGTH}}))?$`,
);

/** A map overlay's file name without `.json`, split into the `map.dat` digest and the basis prefix a
 *  further overlay of that digest carries. */
export interface MapOverlayFileId {
  readonly datDigest: string;
  readonly basisPrefix: string | undefined;
}

/** The parts of map overlay file name `id` (without `.json`), or undefined when it has neither form. */
export function parseMapOverlayFileId(id: string): MapOverlayFileId | undefined {
  const match = MAP_OVERLAY_FILE_ID.exec(id);
  const datDigest = match?.[1];
  return datDigest === undefined ? undefined : { datDigest, basisPrefix: match?.[2] };
}

/** The file name without `.json` of a map overlay of `datDigest`: a further one takes its basis prefix. */
export function mapOverlayFileId(datDigest: string, basisDigest?: string): string {
  return basisDigest === undefined
    ? datDigest
    : `${datDigest}.${basisDigest.slice(0, MAP_OVERLAY_BASIS_PREFIX_LENGTH)}`;
}

/**
 * `translations/<lang>/objects/<table>.json`: one game-object name table (`goods`, `houses`, `jobs`,
 * `experiences`, `tribes`) by type id, with the plural where the table has one.
 */
export const ObjectTableOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  basis: OverlayBasis,
  names: z.record(IdKey, z.string()),
  plurals: z.record(IdKey, z.string()).default({}),
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
