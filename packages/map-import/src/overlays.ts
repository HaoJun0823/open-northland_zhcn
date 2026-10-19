import {
  isSourceLanguage,
  jsonFingerprint,
  type Language,
  MAP_OVERLAY_BASIS_PREFIX_LENGTH,
  MAP_TEXT_LANGUAGES,
  type MapOverlay,
  type OverlayBasis,
  type SourceLanguage,
} from '@open-northland/data';
import { readBriefingBlocks } from './briefing.js';
import { sha256Hex } from './digest.js';
import { DEFAULT_ROOT_NAME, type MapFolder, mapFolderOf } from './folder.js';
import {
  BRIEFINGS_DIR,
  BRIEFINGS_FILE,
  MAP_DAT_FILE,
  STRING_TABLE_DIR,
  STRING_TABLE_FILES,
} from './layout.js';
import { loadMapStringTables, type MapStringTables } from './meta.js';
import type { MapTree } from './tree.js';

/** The repository's translation overlays as a converter reads them, keyed by the raw `map.dat` digest. */
export interface MapOverlaySource {
  /** The overlays filed under one `map.dat` SHA-256 hex digest, by language, one per basis text; empty
   *  for none. */
  readonly mapOverlays: (datDigest: string) => ReadonlyMap<Language, readonly MapOverlay[]>;
  /** Whether an overlay in a source language may apply: a community map's, never a campaign map's. */
  readonly allowSourceLanguages: boolean;
}

/**
 * What became of one language's overlays on a map. `redundant`: a translation into a language the folder
 * ships itself, whose shipped text wins. `refused`: a source-language overlay the caller does not allow.
 * `ambiguous`: several overlays share the `map.dat` and none was written against the folder's text;
 * `candidates` are their bases. `stale`: the applied overlay, the only one of its language, was written
 * against other text than the folder's in its basis language.
 */
export type MapOverlayOutcome =
  | { readonly lang: Language; readonly status: 'applied'; readonly stale: boolean }
  | { readonly lang: Language; readonly status: 'redundant' | 'refused' }
  | { readonly lang: Language; readonly status: 'ambiguous'; readonly candidates: readonly OverlayBasis[] };

/** The overlays a map takes, and what became of every overlay filed under it. */
export interface MapOverlayPlan {
  readonly applied: ReadonlyMap<Language, MapOverlay>;
  readonly outcomes: readonly MapOverlayOutcome[];
}

const NO_OVERLAYS: MapOverlayPlan = { applied: new Map(), outcomes: [] };

/**
 * A map overlay's `basis.digest`: `jsonFingerprint({ strings, briefings })` over one language's string
 * table as `loadMapStringTables` decodes it and its `briefings.txt` blocks by label, both from the files
 * as the pack shipped them, before any correction. A language that lacks either contributes an empty
 * object for it.
 */
export function mapSourceTextDigest(
  strings: Readonly<Record<number, string>>,
  briefings: ReadonlyMap<string, string>,
): string {
  return jsonFingerprint({ strings: { ...strings }, briefings: Object.fromEntries(briefings) });
}

/** Whether the folder ships text in `lang`: a string table or a `briefings.txt`. */
function shipsLanguage(folder: MapFolder, tables: MapStringTables, lang: Language): boolean {
  return (
    tables[lang] !== undefined ||
    folder.read([STRING_TABLE_DIR, lang, BRIEFINGS_DIR, BRIEFINGS_FILE]) !== undefined
  );
}

/** One language's `briefings.txt` blocks, an unreadable file counting as none; the briefing render
 *  warns about it. */
function briefingBlocksOrNone(folder: MapFolder, lang: Language): ReadonlyMap<string, string> {
  try {
    return readBriefingBlocks(folder, lang) ?? new Map();
  } catch {
    return new Map();
  }
}

/** One language's text files, the ones a basis digest reads, by their path under the map folder. */
function languageTextFiles(lang: Language): string[][] {
  return [
    ...STRING_TABLE_FILES.map((form) => [STRING_TABLE_DIR, lang, form]),
    [STRING_TABLE_DIR, lang, BRIEFINGS_DIR, BRIEFINGS_FILE],
  ];
}

/**
 * One language's basis digest. `shipped` answers the pack's bytes of a file a source correction
 * changed, by its path under the folder; such a language is decoded again from the shipped bytes.
 */
function sourceDigest(
  folder: MapFolder,
  tables: MapStringTables,
  lang: Language,
  shipped: ((segments: readonly string[]) => Uint8Array | undefined) | undefined,
): string {
  if (shipped === undefined || languageTextFiles(lang).every((file) => shipped(file) === undefined))
    return mapSourceTextDigest(tables[lang] ?? {}, briefingBlocksOrNone(folder, lang));
  const original: MapFolder = {
    ...folder,
    read: (segments) => shipped(segments) ?? folder.read(segments),
    warn: () => {},
  };
  return mapSourceTextDigest(loadMapStringTables(original)[lang] ?? {}, briefingBlocksOrNone(original, lang));
}

/** One language's text as a map folder ships it, the input of {@link mapSourceTextDigest}. */
export interface MapLanguageText {
  readonly strings: Readonly<Record<number, string>>;
  readonly briefings: ReadonlyMap<string, string>;
}

/** The text a map folder's overlays are checked against: its `map.dat` digest and every language it ships. */
export interface MapSourceText {
  readonly datDigest: string;
  readonly languages: Partial<Record<Language, MapLanguageText>>;
}

/**
 * Reads the overlay identity and source text of folder `key` of a trusted tree without converting the
 * map, for the translations audit; the tree holds the files as the pack shipped them. Undefined when
 * the folder holds no `map.dat`.
 */
export async function readMapSourceText(tree: MapTree, key: string): Promise<MapSourceText | undefined> {
  const folder = mapFolderOf(tree, key, DEFAULT_ROOT_NAME, () => {});
  const dat = folder.read([MAP_DAT_FILE]);
  if (dat === undefined) return undefined;
  const tables = loadMapStringTables(folder);
  const languages: Partial<Record<Language, MapLanguageText>> = {};
  for (const lang of MAP_TEXT_LANGUAGES) {
    if (!shipsLanguage(folder, tables, lang)) continue;
    languages[lang] = { strings: tables[lang] ?? {}, briefings: briefingBlocksOrNone(folder, lang) };
  }
  return { datDigest: await sha256Hex(dat), languages };
}

/**
 * The overlay of one language a map takes among `candidates`, those filed under its `map.dat`: the one
 * whose `basis.digest` is `sourceDigest` of its basis language, else the only one, which is then stale.
 * Undefined when several were filed and none matches, since none can be told to be this map's.
 */
export function selectMapOverlay(
  candidates: readonly MapOverlay[],
  sourceDigest: (lang: SourceLanguage) => string,
): { readonly overlay: MapOverlay; readonly stale: boolean } | undefined {
  const matching = candidates.find((overlay) => sourceDigest(overlay.basis.lang) === overlay.basis.digest);
  if (matching !== undefined) return { overlay: matching, stale: false };
  const [only, ...others] = candidates;
  return only === undefined || others.length > 0 ? undefined : { overlay: only, stale: true };
}

/** A basis as a warning names it: its language and the digest prefix a variant file name carries. */
function basisLabel({ lang, digest }: OverlayBasis): string {
  return `${lang} ${digest.slice(0, MAP_OVERLAY_BASIS_PREFIX_LENGTH)}`;
}

/**
 * Decides which overlays of `datDigest` the map takes, warning about each one it leaves out or finds
 * stale. `tables` are the folder's decoded tables before any string correction, and `shipped` answers
 * the pack's bytes of a file a source correction changed. An overlay whose language is its basis
 * language edits the shipped text and is not redundant.
 */
export function planMapOverlays(
  folder: MapFolder,
  tables: MapStringTables,
  datDigest: string,
  source: MapOverlaySource | undefined,
  shipped?: (segments: readonly string[]) => Uint8Array | undefined,
): MapOverlayPlan {
  const overlays = source?.mapOverlays(datDigest);
  if (source === undefined || overlays === undefined || overlays.size === 0) return NO_OVERLAYS;
  const digests = new Map<SourceLanguage, string>();
  const digestOf = (lang: SourceLanguage): string => {
    const known = digests.get(lang);
    if (known !== undefined) return known;
    const digest = sourceDigest(folder, tables, lang, shipped);
    digests.set(lang, digest);
    return digest;
  };
  const applied = new Map<Language, MapOverlay>();
  const outcomes: MapOverlayOutcome[] = [];
  for (const lang of MAP_TEXT_LANGUAGES) {
    const candidates = overlays.get(lang) ?? [];
    if (candidates.length === 0) continue;
    if (isSourceLanguage(lang) && !source.allowSourceLanguages) {
      folder.warn(
        `translation overlay ${lang} refused: a source-language overlay applies to community maps only`,
      );
      outcomes.push({ lang, status: 'refused' });
      continue;
    }
    const selected = selectMapOverlay(candidates, digestOf);
    if (selected === undefined) {
      folder.warn(
        `translation overlay ${lang} left out: none of the ${candidates.length} filed under its map.dat ` +
          `was written against its text (bases ${candidates.map((overlay) => basisLabel(overlay.basis)).join(', ')})`,
      );
      outcomes.push({ lang, status: 'ambiguous', candidates: candidates.map((overlay) => overlay.basis) });
      continue;
    }
    const { overlay, stale } = selected;
    if (lang !== overlay.basis.lang && shipsLanguage(folder, tables, lang)) {
      folder.warn(`translation overlay ${lang} redundant: the map ships ${lang} text itself`);
      outcomes.push({ lang, status: 'redundant' });
      continue;
    }
    if (stale) folder.warn(`translation overlay ${lang} stale: its ${overlay.basis.lang} basis text changed`);
    applied.set(lang, overlay);
    outcomes.push({ lang, status: 'applied', stale });
  }
  return { applied, outcomes };
}

/**
 * `tables` with each applied overlay's strings over its language's table: an overlay entry replaces the
 * entry of its id and the table keeps the ids the overlay lacks. A language the folder does not ship
 * takes the overlay alone.
 */
export function overlayStringTables(
  tables: MapStringTables,
  applied: ReadonlyMap<Language, MapOverlay>,
): MapStringTables {
  const merged: MapStringTables = { ...tables };
  for (const [lang, overlay] of applied) {
    if (Object.keys(overlay.strings).length === 0) continue;
    merged[lang] = { ...tables[lang], ...overlay.strings };
  }
  return merged;
}
