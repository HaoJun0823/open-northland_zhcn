import { LANGUAGES, type Language, type MapOverlay } from '@open-northland/data';
import type { MapOverlaySource } from '@open-northland/map-import';
import type { SourceRoots } from '../../roots.js';
import type { MapDatConversion } from './convert.js';

const NO_OVERLAYS: ReadonlyMap<Language, MapOverlay> = new Map();

/** The run's map overlays as a converter reads them, or undefined when the run loaded none. */
export function mapOverlaySource(
  roots: SourceRoots,
  allowSourceLanguages: boolean,
): MapOverlaySource | undefined {
  const maps = roots.overlays?.maps;
  if (maps === undefined) return undefined;
  return { mapOverlays: (digest) => maps.get(digest) ?? NO_OVERLAYS, allowSourceLanguages };
}

/** The run-log line of the map overlays: applied per language, then the ones left out or stale. */
export function summarizeMapOverlays(maps: readonly MapDatConversion[], filed: ReadonlySet<string>): string {
  const applied = new Map<Language, number>();
  let redundant = 0;
  let refused = 0;
  let stale = 0;
  for (const map of maps) {
    for (const outcome of map.overlays) {
      if (outcome.status === 'applied') {
        applied.set(outcome.lang, (applied.get(outcome.lang) ?? 0) + 1);
        if (outcome.stale) stale++;
      } else if (outcome.status === 'redundant') redundant++;
      else refused++;
    }
  }
  const converted = new Set(maps.map((map) => map.datDigest));
  const unmatched = [...filed].filter((digest) => !converted.has(digest)).length;
  const perLanguage =
    LANGUAGES.flatMap((lang) => {
      const count = applied.get(lang);
      return count === undefined ? [] : [`${lang}:${count}`];
    }).join(' ') || 'none';
  return (
    `map overlays applied ${perLanguage}, ${redundant} redundant, ${refused} refused, ${stale} stale, ` +
    `${unmatched} filed for no map of this pack`
  );
}
