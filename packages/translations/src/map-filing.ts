import {
  type Language,
  MAP_OVERLAY_BASIS_PREFIX_LENGTH,
  MAP_OVERLAY_DAT_PREFIX_LENGTH,
  type MapOverlay,
  parseMapOverlayFileId,
} from '@open-northland/data';

/** Map overlays by `mapOverlayDatKey` (the `map.dat` SHA-256 prefix their names carry), then language:
 *  one per basis text, in file name order. */
export type MapOverlaysByDatKey = ReadonlyMap<string, ReadonlyMap<Language, readonly MapOverlay[]>>;

/** Why a map overlay file name has neither form. */
export const MAP_OVERLAY_NAMING =
  'a map overlay is named <map>.<map.dat prefix>.json: its map alias, a dot and the first ' +
  `${MAP_OVERLAY_DAT_PREFIX_LENGTH} hex digits of its map.dat SHA-256; a further one of that map.dat ` +
  `and language adds a dot and the first ${MAP_OVERLAY_BASIS_PREFIX_LENGTH} hex digits of its basis.digest`;

/**
 * Files map overlays as their names say. It refuses a name of neither form, a name whose alias is not the
 * overlay's `map`, a basis prefix that does not begin the overlay's `basis.digest`, and a second file of
 * one language and `map.dat` with the same basis digest, which no map could tell apart from the first.
 */
export class MapOverlayFiling {
  private readonly filed = new Map<string, Map<Language, MapOverlay[]>>();
  /** The file name holding each basis digest, by `<lang>/<map.dat key>/<basis digest>`. */
  private readonly names = new Map<string, string>();

  get maps(): MapOverlaysByDatKey {
    return this.filed;
  }

  /** Files the overlay of `<lang>/maps/<name>.json`; answers why it does not belong there instead. */
  file(lang: Language, name: string, overlay: MapOverlay): string | undefined {
    const id = parseMapOverlayFileId(name);
    if (id === undefined) return MAP_OVERLAY_NAMING;
    if (id.map !== overlay.map)
      return `the name's map alias ${id.map} is not the overlay's map ${overlay.map}`;
    const { digest } = overlay.basis;
    if (id.basisPrefix !== undefined && !digest.startsWith(id.basisPrefix))
      return `the name's basis prefix ${id.basisPrefix} does not begin basis.digest ${digest}`;
    const key = `${lang}/${id.datKey}/${digest}`;
    const first = this.names.get(key);
    if (first !== undefined) return `${first}.json has the same map.dat and basis.digest`;
    this.names.set(key, name);
    const byLanguage = this.filed.get(id.datKey) ?? new Map<Language, MapOverlay[]>();
    byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), overlay]);
    this.filed.set(id.datKey, byLanguage);
    return undefined;
  }
}
