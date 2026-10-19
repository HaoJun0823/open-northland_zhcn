import { LANGUAGE_INFO, type SourceLanguage } from '@open-northland/data';
import { parseBriefingBlocks } from '@open-northland/formats/hypertext';
import { decodeCifStringTable, extractStringTable, parseIniSections } from '@open-northland/formats/ini';
import { mapSourceTextDigest as digestOf } from '@open-northland/map-import';

/** A map folder's file by its logical path segments, matched case-insensitively. */
export type MapFileReader = (segments: readonly string[]) => Promise<Uint8Array | undefined>;

/** One language's decoded map text: the string table and the `briefings.txt` block bodies. */
export interface MapSourceText {
  readonly strings: Readonly<Record<string, string>>;
  readonly briefings: Readonly<Record<string, string>>;
}

const STRING_TABLE_FORMS = ['strings.ini', 'strings.cif'] as const;
const BRIEFINGS_PATH = ['briefings', 'briefings.txt'] as const;

function codePageOf(lang: SourceLanguage): string {
  const codePage = LANGUAGE_INFO[lang].codePage;
  if (codePage === undefined) throw new Error(`${lang} names no code page`);
  return codePage;
}

/** Plaintext may be UTF-8 when the whole file decodes as such, else it is the language's code page. */
function decodeMapText(bytes: Uint8Array, lang: SourceLanguage): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(codePageOf(lang)).decode(bytes);
  }
}

/**
 * Decodes `text/<lang>/` the way the map importer's `loadMapStringTables` reads it, over an async
 * reader because campaign maps are read through their `campaign.json` path mapping: `strings.ini` before `strings.cif`, an
 * undecodable or empty table falling through to the next form, and the blocks of
 * `briefings/briefings.txt` (none when the file is absent). Undefined when the map ships no string table
 * in `lang`.
 */
export async function readMapSourceText(
  read: MapFileReader,
  lang: SourceLanguage,
): Promise<MapSourceText | undefined> {
  let strings: Record<number, string> | undefined;
  for (const form of STRING_TABLE_FORMS) {
    const bytes = await read(['text', lang, form]);
    if (bytes === undefined) continue;
    let table: Record<number, string>;
    try {
      table =
        form === 'strings.ini'
          ? extractStringTable(parseIniSections(decodeMapText(bytes, lang)))
          : decodeCifStringTable(bytes, codePageOf(lang));
    } catch {
      continue;
    }
    if (Object.keys(table).length > 0) {
      strings = table;
      break;
    }
  }
  if (strings === undefined) return undefined;
  const briefingsBytes = await read(['text', lang, ...BRIEFINGS_PATH]);
  const briefings =
    briefingsBytes === undefined
      ? {}
      : Object.fromEntries(parseBriefingBlocks(decodeMapText(briefingsBytes, lang)));
  return { strings, briefings };
}

/** The `basis.digest` of a map overlay written against `text`: the map importer's definition. */
export function mapSourceTextDigest(text: MapSourceText): string {
  return digestOf(text.strings, new Map(Object.entries(text.briefings)));
}
