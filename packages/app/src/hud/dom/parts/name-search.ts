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
