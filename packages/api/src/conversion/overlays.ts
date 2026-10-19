import { jsonFingerprint, type Language, type MapOverlay } from '@open-northland/data';
import type { MapOverlaySource } from '@open-northland/map-import';
import type { TranslationOverlays } from '@open-northland/translations';

/** The repository's map overlays by raw `map.dat` digest, then language. Loaded once per process; each
 *  conversion worker receives a structured clone. */
export type CatalogMapOverlays = TranslationOverlays['maps'];

const NO_LANGUAGES: ReadonlyMap<Language, readonly MapOverlay[]> = new Map();

/** Every catalogue archive is a community map, so an overlay in a source language applies to it too. */
export function catalogOverlaySource(overlays: CatalogMapOverlays): MapOverlaySource {
  return { mapOverlays: (digest) => overlays.get(digest) ?? NO_LANGUAGES, allowSourceLanguages: true };
}

/** The fingerprint of the overlays filed under each of `datDigests`, by digest, every file of a language
 *  included: none hashes too, so a conversion made without an overlay notices one filed later. */
export function overlayFingerprints(
  overlays: CatalogMapOverlays,
  datDigests: Iterable<string>,
): Record<string, string> {
  const fingerprints: Record<string, string> = {};
  for (const digest of datDigests)
    fingerprints[digest] = jsonFingerprint(Object.fromEntries(overlays.get(digest) ?? NO_LANGUAGES));
  return fingerprints;
}

/** Whether every digest a conversion recorded still has the overlays it was converted with. */
export function overlaysUnchanged(
  overlays: CatalogMapOverlays,
  recorded: Readonly<Record<string, string>>,
): boolean {
  const current = overlayFingerprints(overlays, Object.keys(recorded));
  return Object.entries(recorded).every(([digest, fingerprint]) => current[digest] === fingerprint);
}
