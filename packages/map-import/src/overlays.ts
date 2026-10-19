import {
  isSourceLanguage,
  jsonFingerprint,
  type Language,
  MAP_TEXT_LANGUAGES,
  type MapOverlay,
} from '@open-northland/data';
import { readBriefingBlocks } from './briefing.js';
import { sha256Hex } from './digest.js';
import { DEFAULT_ROOT_NAME, type MapFolder, mapFolderOf } from './folder.js';
import { BRIEFINGS_DIR, BRIEFINGS_FILE, MAP_DAT_FILE, STRING_TABLE_DIR } from './layout.js';
import { loadMapStringTables, type MapStringTables } from './meta.js';
import type { MapTree } from './tree.js';

/** The repository's translation overlays as a converter reads them, keyed by the raw `map.dat` digest. */
export interface MapOverlaySource {
  /** The overlays filed under one `map.dat` SHA-256 hex digest, by language; empty for none. */
  readonly mapOverlays: (datDigest: string) => ReadonlyMap<Language, MapOverlay>;
  /** Whether an overlay in a source language may apply: a community map's, never a campaign map's. */
  readonly allowSourceLanguages: boolean;
}

/**
 * What became of one language's overlay on a map. `redundant`: a translation into a language the folder
 * ships itself, whose shipped text wins. `refused`: a source-language overlay the caller does not allow.
 * `stale`: the overlay's basis digest differs from the folder's current text in the basis language.
 */
export type MapOverlayOutcome =
  | { readonly lang: Language; readonly status: 'applied'; readonly stale: boolean }
  | { readonly lang: Language; readonly status: 'redundant' | 'refused' };

/** The overlays a map takes, and what became of every overlay filed under it. */
export interface MapOverlayPlan {
  readonly applied: ReadonlyMap<Language, MapOverlay>;
  readonly outcomes: readonly MapOverlayOutcome[];
}

const NO_OVERLAYS: MapOverlayPlan = { applied: new Map(), outcomes: [] };

/**
 * A map overlay's `basis.digest`: `jsonFingerprint({ strings, briefings })` over one language's string
 * table as `loadMapStringTables` decodes it from the converter's tree (whole-file source corrections
 * applied, map-string corrections not) and its `briefings.txt` blocks by label. A language that lacks
 * either contributes an empty object for it.
 */
export function mapSourceTextDigest(
  strings: Readonly<Record<number, string>>,
  briefings: ReadonlyMap<string, string>,
): string {
  return jsonFingerprint({ strings: { ...strings }, briefings: Object.fromEntries(briefings) });
}

/** Whether the folder ships text in `lang`: a string table or a `briefings.txt`. */
export function shipsLanguage(folder: MapFolder, tables: MapStringTables, lang: Language): boolean {
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

function sourceDigest(folder: MapFolder, tables: MapStringTables, lang: Language): string {
  return mapSourceTextDigest(tables[lang] ?? {}, briefingBlocksOrNone(folder, lang));
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
 * map, for the translations audit. Undefined when the folder holds no `map.dat`.
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
 * Decides which overlays of `datDigest` the map takes, warning about each one it leaves out or finds
 * stale. `tables` are the folder's decoded tables before any string correction. An overlay whose
 * language is its basis language edits the shipped text and is not redundant.
 */
export function planMapOverlays(
  folder: MapFolder,
  tables: MapStringTables,
  datDigest: string,
  source: MapOverlaySource | undefined,
): MapOverlayPlan {
  const overlays = source?.mapOverlays(datDigest);
  if (source === undefined || overlays === undefined || overlays.size === 0) return NO_OVERLAYS;
  const applied = new Map<Language, MapOverlay>();
  const outcomes: MapOverlayOutcome[] = [];
  for (const lang of MAP_TEXT_LANGUAGES) {
    const overlay = overlays.get(lang);
    if (overlay === undefined) continue;
    if (isSourceLanguage(lang) && !source.allowSourceLanguages) {
      folder.warn(
        `translation overlay ${lang} refused: a source-language overlay applies to community maps only`,
      );
      outcomes.push({ lang, status: 'refused' });
      continue;
    }
    if (lang !== overlay.basis.lang && shipsLanguage(folder, tables, lang)) {
      folder.warn(`translation overlay ${lang} redundant: the map ships ${lang} text itself`);
      outcomes.push({ lang, status: 'redundant' });
      continue;
    }
    const stale = sourceDigest(folder, tables, overlay.basis.lang) !== overlay.basis.digest;
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
