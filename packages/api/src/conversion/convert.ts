import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CATALOG_MAP_ID, type CatalogConvertedMap, MAP_TEXT_LANGUAGES } from '@open-northland/data';
import { type ConvertedMap, convertMapTree, mapFiles, openArchive } from '@open-northland/map-import';

const UNRAR_WASM_PATH = 'node-unrar-js/esm/js/unrar.wasm';
/** The first repeat of a map id inside one entry gets this suffix, the next one more. */
const FIRST_REPEAT = 2;

/** The unrar wasm binary that `openArchive` needs for a RAR, read once at start. */
export function loadUnrarWasm(): ArrayBuffer {
  const bytes = readFileSync(createRequire(import.meta.url).resolve(UNRAR_WASM_PATH));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export interface ArchiveConversion {
  readonly maps: readonly CatalogConvertedMap[];
  /** Every sidecar by file name, the map id first: `<mapId><suffix>`. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface ConvertArchiveOptions {
  readonly unrarWasm: ArrayBuffer;
  readonly onWarning?: (message: string) => void;
}

/** `<entryId>-<slug>`, with `-2`, `-3` for a slug already taken inside the entry. */
function uniqueMapId(entryId: string, slug: string, taken: Set<string>): string {
  const base = `${entryId}-${slug}`;
  let mapId = base;
  for (let repeat = FIRST_REPEAT; taken.has(mapId); repeat++) mapId = `${base}-${repeat}`;
  if (!CATALOG_MAP_ID.test(mapId)) throw new Error(`map id ${mapId} is not a valid map id`);
  taken.add(mapId);
  return mapId;
}

function utf8(file: string | Uint8Array): Uint8Array {
  return typeof file === 'string' ? Buffer.from(file, 'utf8') : file;
}

function languagesOf(map: ConvertedMap): CatalogConvertedMap['languages'] {
  return MAP_TEXT_LANGUAGES.filter((language) => map.strings?.[language] !== undefined);
}

/** Opens a catalogue file and converts every map in it, each renamed into the entry's id space. Throws
 *  `MapImportError` for an archive or tree that yields no map. */
export async function convertArchive(
  bytes: Uint8Array,
  entryId: string,
  options: ConvertArchiveOptions,
): Promise<ArchiveConversion> {
  const onWarning = options.onWarning ?? (() => undefined);
  const tree = await openArchive(bytes, { unrarWasm: options.unrarWasm, name: entryId });
  const { maps: converted, skipped } = await convertMapTree(tree, { provenance: 'catalog', onWarning });
  for (const { folder, message } of skipped) onWarning(`${folder} skipped: ${message}`);
  const taken = new Set<string>();
  const maps: CatalogConvertedMap[] = [];
  const files = new Map<string, Uint8Array>();
  for (const map of converted) {
    const mapId = uniqueMapId(entryId, map.id, taken);
    const renamed: ConvertedMap = { ...map, id: mapId, index: { ...map.index, id: mapId } };
    const own = mapFiles(renamed);
    maps.push({
      mapId,
      folder: map.id,
      fingerprint: renamed.index.fingerprint,
      languages: languagesOf(renamed),
      cells: { width: renamed.terrain.width, height: renamed.terrain.height },
      index: renamed.index,
    });
    for (const [name, file] of own) files.set(name, utf8(file));
    for (const [name, png] of map.pictures) files.set(`${mapId}.pictures-${name}`, png);
  }
  return { maps, files };
}
