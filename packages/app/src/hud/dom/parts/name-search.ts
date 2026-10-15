import { bcp47Tag } from '../../../i18n/index.js';

/** A name as a search compares it: trimmed, lower case, without diacritics. */
export const foldedName = (text: string): string =>
  text
    .trim()
    .toLocaleLowerCase(bcp47Tag())
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('ł', 'l');

export const nameMatches = (label: string, query: string): boolean =>
  foldedName(label).startsWith(foldedName(query));

/** Anywhere in the name, for a long catalogue searched by any word ("long" finds "Longbow Archer"). */
export const nameContains = (label: string, query: string): boolean =>
  foldedName(label).includes(foldedName(query));

/** Every typed word anywhere in the name, in any order ("obronna wiez" finds "Wieża obronna 1"). */
export const nameHasWords = (label: string, query: string): boolean => {
  const name = foldedName(label);
  return foldedName(query)
    .split(/\s+/)
    .every((word) => name.includes(word));
};
