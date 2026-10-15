/** Text as a search compares it: lower case without diacritics, so "zolw" finds "Żółw". Locale-independent,
 *  so the host locale cannot change a match; `ł` has no decomposition of its own. */
export const foldText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[łŁ]/g, 'l').toLowerCase();

/** The query's folded words; none for a blank query. */
export const searchWords = (query: string): readonly string[] => foldText(query).split(/\s+/).filter(Boolean);

/** Every word anywhere in the text, in any order ("obronna wiez" finds "Wieża obronna 1"). Join several
 *  fields with a line break: no word holds one, so no match spans two fields. */
export const hasWords = (text: string, words: readonly string[]): boolean => {
  if (words.length === 0) return true;
  const folded = foldText(text);
  return words.every((word) => folded.includes(word));
};

/** The whole query anywhere in the name ("long" finds "Longbow Archer"). */
export const nameContains = (label: string, query: string): boolean =>
  foldText(label).includes(foldText(query).trim());
