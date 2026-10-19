import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findPathCaseInsensitive,
  type GameObjectNames,
  type GameObjectTable,
} from '@open-northland/asset-pipeline/sources';
import { decodeIni, extractStringnNames, parseIniSections } from '@open-northland/formats/ini';

const UTF8 = 'utf-8';

/** One UTF-8 `.ini` table of the localization repository's `text/<folder>/strings/gameobjects/`. */
export async function readLocalizedObjectTable(
  textRoot: string,
  folder: string,
  table: GameObjectTable,
): Promise<GameObjectNames | undefined> {
  const path = await findPathCaseInsensitive(join(textRoot, folder), [
    'strings',
    'gameobjects',
    `${table}.ini`,
  ]);
  if (path === undefined) return undefined;
  const { singular, plural } = extractStringnNames(parseIniSections(decodeIni(await readFile(path), UTF8)));
  return { names: singular, plurals: plural };
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
export function driftedIds(basis: GameObjectNames, theirGerman: GameObjectNames): string[] {
  const drifted = new Set<string>();
  for (const key of ['names', 'plurals'] as const) {
    for (const [id, garbled] of Object.entries(theirGerman[key])) {
      const ours = basis[key][Number(id)];
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
  translated: GameObjectNames,
  basis: GameObjectNames,
  drifted: readonly string[],
): {
  readonly names: Record<string, string>;
  readonly plurals: Record<string, string>;
  readonly unknown: number;
} {
  let unknown = 0;
  const pick = (from: Readonly<Record<number, string>>, known: Readonly<Record<number, string>>) => {
    const out: Record<string, string> = {};
    for (const [id, text] of Object.entries(from)) {
      if (text.trim() === '' || drifted.includes(id)) continue;
      if (known[Number(id)] === undefined) unknown++;
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
