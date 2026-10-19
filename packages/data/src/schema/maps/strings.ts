import { z } from 'zod';
import { LANGUAGES, type Language } from '../../languages.js';

/** The languages a map's text can be served in, most preferred first: the registry's fallback order.
 *  A source language comes from the map folder's `text/<lang>/`, an overlay language from the
 *  repository's translation overlays. */
export const MAP_TEXT_LANGUAGES = LANGUAGES;
export type MapTextLanguage = Language;

/**
 * `maps/<id>.strings.json`: one map's own string table per shipped language, keyed by string id.
 * A language the folder does not ship is absent.
 */
export const MapStrings = z.partialRecord(z.enum(MAP_TEXT_LANGUAGES), z.record(z.string(), z.string()));
export type MapStrings = z.infer<typeof MapStrings>;

/** One map text (name, description, seat name) in every shipped language that carries it. */
export const MapText = z.partialRecord(z.enum(MAP_TEXT_LANGUAGES), z.string());
export type MapText = z.infer<typeof MapText>;
