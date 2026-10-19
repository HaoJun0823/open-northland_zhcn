import type { Language, MapOverlay } from '@open-northland/data';
import type { MapOverlaySource } from '@open-northland/map-import';
import type { TranslationOverlays } from '@open-northland/translations';

/** The repository's map overlays by raw `map.dat` digest, then language. Loaded once per process; each
 *  conversion worker receives a structured clone. */
export type CatalogMapOverlays = TranslationOverlays['maps'];

export const NO_MAP_OVERLAYS: CatalogMapOverlays = new Map();
const NO_LANGUAGES: ReadonlyMap<Language, MapOverlay> = new Map();

/** Every catalogue archive is a community map, so an overlay in a source language applies to it too. */
export function catalogOverlaySource(overlays: CatalogMapOverlays): MapOverlaySource {
  return { mapOverlays: (digest) => overlays.get(digest) ?? NO_LANGUAGES, allowSourceLanguages: true };
}
