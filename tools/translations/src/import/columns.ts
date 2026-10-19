import type { OverlayLanguage, SourceLanguage } from '@open-northland/data';
import { SIMPLIFIED_COLUMN, TRADITIONAL_COLUMN } from './map-xml.js';

/**
 * Where each overlay language lives in CulturesGameLocalization: its column in the map XMLs and its
 * folder under `Localization/text/` (the game's language slots 10 and 11).
 */
export const LOCALIZATION_SOURCES: Readonly<
  Record<OverlayLanguage, { readonly column: string; readonly textFolder: string }>
> = {
  chs: { column: SIMPLIFIED_COLUMN, textFolder: 'l10' },
  cht: { column: TRADITIONAL_COLUMN, textFolder: 'l11' },
};

/**
 * German is the localization's source language: every imported overlay is written against our pack's
 * German text, and the repository's own German column and folder prove the keys line up.
 */
export const BASIS_LANGUAGE: SourceLanguage = 'ger';
