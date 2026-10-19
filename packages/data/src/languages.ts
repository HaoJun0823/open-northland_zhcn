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
  /** The legacy code page its source text files use; an overlay language ships only UTF-8 JSON. */
  readonly codePage?: 'windows-1250' | 'windows-1251';
}

export const LANGUAGE_INFO: Readonly<Record<Language, LanguageInfo>> = {
  pol: { code: 'pol', tag: 'pl', wrap: 'word', codePage: 'windows-1250' },
  eng: { code: 'eng', tag: 'en', wrap: 'word', codePage: 'windows-1250' },
  ger: { code: 'ger', tag: 'de', wrap: 'word', codePage: 'windows-1250' },
  rus: { code: 'rus', tag: 'ru', wrap: 'word', codePage: 'windows-1251' },
  chs: { code: 'chs', tag: 'zh-Hans', wrap: 'character' },
  cht: { code: 'cht', tag: 'zh-Hant', wrap: 'character' },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === 'string' && (SOURCE_LANGUAGES as readonly string[]).includes(value);
}
