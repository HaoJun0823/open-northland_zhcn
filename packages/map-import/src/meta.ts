import { MAP_TEXT_LANGUAGES, type MapMeta, type MapText, type MapTextLanguage } from '@open-northland/data';
import {
  decodeCifStringTable,
  extractMapTypes,
  extractMusicType,
  extractStringTable,
  iniBytesToSections,
  type MapTypeHeader,
  parseIniSections,
  type RuleSection,
} from '@open-northland/formats/ini';
import { errorMessage } from './errors.js';
import type { MapFolder } from './folder.js';
import { HEADER_FILES, STRING_TABLE_DIR, STRING_TABLE_FILES } from './layout.js';
import { decodeMapText, mapTextEncoding } from './text.js';

/** The emitted `maps/<id>.meta.json` sidecar: the map's menu-facing strings and music binding. */
export type MapMetaFile = MapMeta;

/** One map folder's string tables, keyed by the language subfolder they were read from. */
export type MapStringTables = Partial<Record<MapTextLanguage, Record<number, string>>>;

/**
 * String-table ids of the map name/description when no header names them. Source basis: observed -
 * most readable `[misc_mapname]` headers say `0`/`1`, and the overriding minority is why the header
 * is consulted first.
 */
const DEFAULT_NAME_STRING_ID = 0;
const DEFAULT_DESCRIPTION_STRING_ID = 1;

/** The resolved map header: name/description string-table ids, the `[misc_music]` code and the
 *  `[misc_maptype]` listing. */
interface MapHeader {
  readonly nameStringId: number;
  readonly descriptionStringId: number;
  readonly musicType?: number;
  readonly mapTypes?: MapTypeHeader;
}

/** Reads one int off a `[misc_mapname]` section prop, or undefined when absent/malformed. */
function sectionInt(sections: readonly RuleSection[], key: string): number | undefined {
  const section = sections.find((s) => s.name === 'misc_mapname');
  const raw = section?.props.find((p) => p.key === key)?.values[0];
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Resolves the map's `[misc_mapname]` string ids, `[misc_music]` code and `[misc_maptype]` listing.
 * The headers ship in three forms and the readable ones win: the split `misc.inc`, the monolithic
 * `map.ini`, then the encrypted `map.cif`'s sections, passed in already decoded so this module never
 * re-decodes the cif.
 */
function resolveMapHeader(folder: MapFolder, cifSections: readonly RuleSection[] | undefined): MapHeader {
  let nameStringId: number | undefined;
  let descriptionStringId: number | undefined;
  let musicType: number | undefined;
  let mapTypes: MapTypeHeader | undefined;
  const consider = (sections: readonly RuleSection[]): void => {
    nameStringId ??= sectionInt(sections, 'mapnamestringid');
    descriptionStringId ??= sectionInt(sections, 'mapdescriptionstringid');
    musicType ??= extractMusicType(sections);
    mapTypes ??= extractMapTypes(sections);
  };
  for (const file of HEADER_FILES) {
    if (
      nameStringId !== undefined &&
      descriptionStringId !== undefined &&
      musicType !== undefined &&
      mapTypes !== undefined
    )
      break;
    const bytes = folder.read([file]);
    if (bytes === undefined) continue;
    try {
      consider(iniBytesToSections(bytes));
    } catch (err) {
      folder.warn(`${file} unreadable: ${errorMessage(err)}`);
    }
  }
  if (cifSections !== undefined) consider(cifSections);
  return {
    nameStringId: nameStringId ?? DEFAULT_NAME_STRING_ID,
    descriptionStringId: descriptionStringId ?? DEFAULT_DESCRIPTION_STRING_ID,
    ...(musicType !== undefined ? { musicType } : {}),
    ...(mapTypes !== undefined ? { mapTypes } : {}),
  };
}

/**
 * Loads every language a map folder ships (`<folder>/text/<lang>/strings.*`) as
 * `{ <stringId>: <text> }`, preferring the readable `strings.ini` over its encrypted `strings.cif`
 * twin. An unreadable or empty table falls through to the next form, then the next language.
 */
export function loadMapStringTables(folder: MapFolder): MapStringTables {
  const tables: MapStringTables = {};
  for (const lang of MAP_TEXT_LANGUAGES) {
    for (const form of STRING_TABLE_FILES) {
      const bytes = folder.read([STRING_TABLE_DIR, lang, form]);
      if (bytes === undefined) continue;
      let table: Record<number, string>;
      try {
        // Owned text/rus/strings.ini uses CP1251 (e.g. CD CE C2 C0 DF spells НОВАЯ).
        const encoding = mapTextEncoding(lang);
        table =
          form === 'strings.ini'
            ? extractStringTable(parseIniSections(decodeMapText(bytes, lang)))
            : decodeCifStringTable(bytes, encoding);
      } catch (err) {
        folder.warn(`text/${lang}/${form} undecodable: ${errorMessage(err)}`);
        continue;
      }
      if (Object.keys(table).length > 0) {
        tables[lang] = table;
        break;
      }
    }
  }
  return tables;
}

/** The table the map's mission texts resolve through: the first language the folder ships, in
 *  {@link MAP_TEXT_LANGUAGES} preference order. */
export function preferredStringTable(tables: MapStringTables): Record<number, string> | undefined {
  for (const lang of MAP_TEXT_LANGUAGES) {
    const table = tables[lang];
    if (table !== undefined) return table;
  }
  return undefined;
}

/** One string id in every shipped language that carries it, so the app picks the reader's language;
 *  undefined when no table has it. */
export function mapTextOf(tables: MapStringTables, stringId: number): MapText | undefined {
  const text: MapText = {};
  for (const lang of MAP_TEXT_LANGUAGES) {
    const value = tables[lang]?.[stringId];
    if (value !== undefined) text[lang] = value;
  }
  return Object.keys(text).length > 0 ? text : undefined;
}

/**
 * Resolves one map folder's meta sidecar: the `[misc_mapname]` header's ids looked up in the folder's
 * string tables, the `[misc_music]` code and the `[misc_maptype]` listing. Returns undefined when
 * nothing resolves. `cifSections` and `tables` come from the caller so each map decodes its cif and
 * loads its tables once.
 */
export function resolveMapMeta(
  folder: MapFolder,
  cifSections: readonly RuleSection[] | undefined,
  tables: MapStringTables = loadMapStringTables(folder),
): MapMetaFile | undefined {
  const { nameStringId, descriptionStringId, musicType, mapTypes } = resolveMapHeader(folder, cifSections);
  const name = mapTextOf(tables, nameStringId);
  const description = mapTextOf(tables, descriptionStringId);
  const listing =
    mapTypes !== undefined &&
    (mapTypes.types.length > 0 || mapTypes.multiplayerOnly || mapTypes.campaign !== undefined);
  if (name === undefined && description === undefined && musicType === undefined && !listing)
    return undefined;
  return {
    ...(mapTypes?.campaign === undefined ? {} : { campaign: mapTypes.campaign }),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(musicType !== undefined ? { musicType } : {}),
    ...(mapTypes === undefined || mapTypes.types.length === 0 ? {} : { mapTypes: [...mapTypes.types] }),
    ...(mapTypes?.multiplayerOnly ? { multiplayerOnly: true } : {}),
  };
}
