/** The sidecars a converted map ships under `/maps/<id><suffix>`: terrain, the four optional JSON
 *  sidecars and the authored picture. The pipeline's `.map.png` minimap is not among them, since a
 *  catalogue map has none. */
export const MAP_FILE_SUFFIXES = [
  '.json',
  '.meta.json',
  '.script.json',
  '.strings.json',
  '.briefing.json',
  '.png',
] as const;
export type MapFileSuffix = (typeof MAP_FILE_SUFFIXES)[number] | `.pictures-${string}.png`;
const BRIEFING_PICTURE_SUFFIX = /^\.pictures-[0-9a-f]{16}\.png$/;
export function isMapFileSuffix(value: unknown): value is MapFileSuffix {
  return (
    typeof value === 'string' &&
    (MAP_FILE_SUFFIXES.some((suffix) => suffix === value) || BRIEFING_PICTURE_SUFFIX.test(value))
  );
}

/** Where the app reads a map's files, whichever store actually holds them. */
export const MAPS_PATH = '/maps/';

export function mapFilePath(mapId: string, suffix: MapFileSuffix): string {
  return `${MAPS_PATH}${mapId}${suffix}`;
}

const PICTURE_SUFFIX: MapFileSuffix = '.png';
const JSON_TYPE = 'application/json';
const PNG_TYPE = 'image/png';

export function mapFileContentType(suffix: MapFileSuffix): string {
  return suffix.endsWith(PICTURE_SUFFIX) ? PNG_TYPE : JSON_TYPE;
}

/** Reads one stored file of a map, or null when the map has none with that suffix. */
export type StoredMapFileReader = (suffix: MapFileSuffix) => Promise<Uint8Array | null>;

/**
 * A `fetch` that answers exactly one map's `/maps/<id><suffix>` paths from a byte store, so the map
 * loaders read an installed map the way they read a served one. Every other path is a 404.
 */
export function storedMapFetch(mapId: string, read: StoredMapFileReader): typeof fetch {
  return async (input) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const prefix = `${MAPS_PATH}${mapId}`;
    const candidate = path.startsWith(prefix) ? path.slice(prefix.length) : null;
    const suffix = isMapFileSuffix(candidate) ? candidate : undefined;
    const bytes = suffix === undefined ? null : await read(suffix);
    if (suffix === undefined || bytes === null) return new Response(null, { status: 404 });
    // A copy owned by the response, so the stored buffer type never leaks into the body.
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': mapFileContentType(suffix), 'content-length': String(bytes.byteLength) },
    });
  };
}
