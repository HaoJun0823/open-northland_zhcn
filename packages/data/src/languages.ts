/**
 * The one language registry. A source language is one the data pack and a map archive can ship text
 * in (`text/<code>/`, `Data/text/<code>/`); an overlay language reaches the game only through the
 * repository's `translations/<code>/` overlays. The order is the text fallback order: a text missing in
 * the reader's language falls back along it, and the culturesnation mod is Polish-authored.
 */
export const SOURCE_LANGUAGES = ['pol', 'eng', 'ger', 'rus'] as const;
export const OVERLAY_LANGUAGES = ['chs', 'cht'] as const;
export const LANGUAGES = [...SOURCE_LANGUAGES, ...OVERLAY_LANGUAGES] as const;

export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];
export type OverlayLanguage = (typeof OVERLAY_LANGUAGES)[number];
export type Language = (typeof LANGUAGES)[number];

/** How a language's text wraps: at spaces, or between any two characters (Han script has no spaces). */
export type LineWrap = 'word' | 'character';

export interface LanguageInfo {
  readonly code: Language;
  /** The BCP-47 tag the UI claims for it (`lang` attributes, `navigator.languages` matching). */
  readonly tag: string;
  readonly wrap: LineWrap;
  /** Languages read before the registry order when a text lacks this one: a Chinese reader is more
   *  likely to read English than the mod's Polish. */
  readonly fallbacks?: readonly Language[];
}

export const LANGUAGE_INFO: Readonly<Record<Language, LanguageInfo>> = {
  pol: { code: 'pol', tag: 'pl', wrap: 'word' },
  eng: { code: 'eng', tag: 'en', wrap: 'word' },
  ger: { code: 'ger', tag: 'de', wrap: 'word' },
  rus: { code: 'rus', tag: 'ru', wrap: 'word' },
  chs: { code: 'chs', tag: 'zh-Hans', wrap: 'character', fallbacks: ['eng'] },
  cht: { code: 'cht', tag: 'zh-Hant', wrap: 'character', fallbacks: ['chs', 'eng'] },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === 'string' && (SOURCE_LANGUAGES as readonly string[]).includes(value);
}

/** The languages a reader of `lang` reads a text in, most preferred first: `lang`, its own fallbacks,
 *  then every language in registry order. */
export function textReadingOrder(lang: Language): readonly Language[] {
  return [...new Set([lang, ...(LANGUAGE_INFO[lang].fallbacks ?? []), ...LANGUAGES])];
}
