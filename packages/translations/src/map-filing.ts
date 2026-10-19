import {
  type Language,
  MAP_OVERLAY_BASIS_PREFIX_LENGTH,
  type MapOverlay,
  parseMapOverlayFileId,
} from '@open-northland/data';

/** Map overlays by the raw `map.dat` SHA-256 hex digest, then language: one per basis text, in file
 *  name order. */
export type MapOverlaysByDigest = ReadonlyMap<string, ReadonlyMap<Language, readonly MapOverlay[]>>;

/** Why a map overlay file name has neither form. */
export const MAP_OVERLAY_NAMING =
  'a map overlay is named by the SHA-256 hex of its map.dat, a further one of that map.dat and ' +
  `language by a dot and the first ${MAP_OVERLAY_BASIS_PREFIX_LENGTH} hex digits of its basis.digest`;

/**
 * Files map overlays as their names say. It refuses a name of neither form, a basis prefix that does not
 * begin the overlay's `basis.digest`, and a second file of one language and `map.dat` with the same
 * basis digest, which no map could tell apart from the first.
 */
export class MapOverlayFiling {
  private readonly filed = new Map<string, Map<Language, MapOverlay[]>>();
  /** The file name holding each basis digest, by `<lang>/<map.dat digest>/<basis digest>`. */
  private readonly names = new Map<string, string>();

  get maps(): MapOverlaysByDigest {
    return this.filed;
  }

  /** Files the overlay of `<lang>/maps/<name>.json`; answers why it does not belong there instead. */
  file(lang: Language, name: string, overlay: MapOverlay): string | undefined {
    const id = parseMapOverlayFileId(name);
    if (id === undefined) return MAP_OVERLAY_NAMING;
    const { digest } = overlay.basis;
    if (id.basisPrefix !== undefined && !digest.startsWith(id.basisPrefix))
      return `the name's basis prefix ${id.basisPrefix} does not begin basis.digest ${digest}`;
    const key = `${lang}/${id.datDigest}/${digest}`;
    const first = this.names.get(key);
    if (first !== undefined) return `${first}.json has the same map.dat and basis.digest`;
    this.names.set(key, name);
    const byLanguage = this.filed.get(id.datDigest) ?? new Map<Language, MapOverlay[]>();
    byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), overlay]);
    this.filed.set(id.datDigest, byLanguage);
    return undefined;
  }
}
