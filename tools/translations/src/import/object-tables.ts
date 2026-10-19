import { join } from 'node:path';
import { jsonFingerprint } from '@open-northland/data';
import {
  cifBytesToSections,
  decodeDisplayText,
  decodeIni,
  extractStringnNames,
  parseIniSections,
  type RuleSection,
} from '@open-northland/formats/ini';
import { textEncoding } from '@open-northland/formats/text-encoding';
import { readCaseInsensitive } from './pack-files.js';

/** The game-object name tables, `strings/gameobjects/<table>.{ini,cif}`, the GUI strings stage reads. */
export const OBJECT_TABLES = ['goods', 'houses', 'jobs', 'experiences', 'tribes'] as const;
export type ObjectTable = (typeof OBJECT_TABLES)[number];

/** A name table by type id: each `stringn` singular and the bare `string` plural after it. */
export interface ObjectNames {
  readonly names: Readonly<Record<string, string>>;
  readonly plurals: Readonly<Record<string, string>>;
}

const UTF8 = 'utf-8';

function decodedNames(sections: readonly RuleSection[], decode: (text: string) => string): ObjectNames {
  const { singular, plural } = extractStringnNames(sections);
  const decodeAll = (table: Record<number, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(table).map(([id, text]) => [id, decode(text)]));
  return { names: decodeAll(singular), plurals: decodeAll(plural) };
}

/**
 * One table of the pack's `Data/text/<lang>/strings/gameobjects/`, read as the GUI strings stage reads
 * it: the readable `.ini` when the language ships one, else the `.cif`. Undefined when neither exists.
 */
export async function readPackObjectTable(
  baseRoot: string,
  lang: string,
  table: ObjectTable,
): Promise<ObjectNames | undefined> {
  const dir = ['Data', 'text', lang, 'strings', 'gameobjects'];
  const encoding = textEncoding(lang);
  const ini = await readCaseInsensitive(baseRoot, [...dir, `${table}.ini`]);
  if (ini !== undefined) return decodedNames(parseIniSections(decodeIni(ini, encoding)), (text) => text);
  const cif = await readCaseInsensitive(baseRoot, [...dir, `${table}.cif`]);
  if (cif === undefined) return undefined;
  return decodedNames(cifBytesToSections(cif), (text) => decodeDisplayText(text, encoding));
}

/** One UTF-8 `.ini` table of the localization repository's `text/<folder>/strings/gameobjects/`. */
export async function readLocalizedObjectTable(
  textRoot: string,
  folder: string,
  table: ObjectTable,
): Promise<ObjectNames | undefined> {
  const bytes = await readCaseInsensitive(join(textRoot, folder), ['strings', 'gameobjects', `${table}.ini`]);
  return bytes === undefined
    ? undefined
    : decodedNames(parseIniSections(decodeIni(bytes, UTF8)), (text) => text);
}

export function objectNamesDigest(names: ObjectNames): string {
  return jsonFingerprint({ names: names.names, plurals: names.plurals });
}

/** The last code point the cp1252 names of their German tables can hold once read back intact. */
const LATIN1_LAST = 0xff;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function normalizeName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Whether our German name is the one their German table garbles: that table's cp1252 bytes were read
 * as GBK, so an umlaut and the byte after it became one Han character (a lone lead byte, one character).
 */
export function sameGermanName(ours: string, garbled: string): boolean {
  const pattern = [...normalizeName(garbled)]
    .map((c) => ((c.codePointAt(0) ?? 0) > LATIN1_LAST ? '[\\s\\S]{1,2}' : c.replace(REGEX_SPECIAL, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`, 'u').test(normalizeName(ours));
}

/** The type ids whose German name or plural differs between their table and ours: a different object. */
export function driftedIds(basis: ObjectNames, theirGerman: ObjectNames): string[] {
  const drifted = new Set<string>();
  for (const key of ['names', 'plurals'] as const) {
    for (const [id, garbled] of Object.entries(theirGerman[key])) {
      const ours = basis[key][id];
      if (ours !== undefined && !sameGermanName(ours, garbled)) drifted.add(id);
    }
  }
  return [...drifted].sort((a, b) => Number(a) - Number(b));
}

/**
 * The translated entries of `translated` for the ids `basis` names, blank ones and `drifted` ones
 * skipped, with the count of ids the basis lacks.
 */
export function translateObjectNames(
  translated: ObjectNames,
  basis: ObjectNames,
  drifted: readonly string[],
): {
  readonly names: Record<string, string>;
  readonly plurals: Record<string, string>;
  readonly unknown: number;
} {
  let unknown = 0;
  const pick = (from: Readonly<Record<string, string>>, known: Readonly<Record<string, string>>) => {
    const out: Record<string, string> = {};
    for (const [id, text] of Object.entries(from)) {
      if (text.trim() === '' || drifted.includes(id)) continue;
      if (known[id] === undefined) unknown++;
      else out[id] = text;
    }
    return out;
  };
  return {
    names: pick(translated.names, basis.names),
    plurals: pick(translated.plurals, basis.plurals),
    unknown,
  };
}
