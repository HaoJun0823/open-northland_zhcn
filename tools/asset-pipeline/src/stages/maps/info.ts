import { readFile } from 'node:fs/promises';
import type { MapInfo, MapProvenance } from '@open-northland/data';
import { cifBytesToSections, extractMapInfo, type SourceRef } from '@open-northland/formats/ini';
import { excludeStringTableCopies, MAP_CIF_FILE, mapIdFromPath } from '@open-northland/map-import';
import { errorMessage } from '../../errors.js';
import { collectSourceFilesNamed, type SourceRoots } from '../../roots.js';
import { mapProvenance } from './provenance.js';

/**
 * One `map.cif`'s bytes plus a slug id to its validated logic header. Throws an `ini:`/`cif:`-prefixed
 * error for a non-map or header-less `.cif`.
 */
export function mapCifToInfo(
  bytes: Uint8Array,
  id: string,
  src: SourceRef,
  provenance: MapProvenance,
): MapInfo {
  return extractMapInfo(cifBytesToSections(bytes), id, src, provenance);
}

/**
 * Decodes the logic header of every `map.cif` under the mod root into a validated `MapInfo`, in
 * path-sorted order so the IR is reproducible regardless of directory-entry order. A `.cif` that
 * fails to read or decode is logged and skipped so one bad file cannot abort the batch. Only the
 * declarative header lands here; the tile grid, `StaticObjects` placements and
 * `playerdata`/`MissionData` script land in per-map artifacts via `convertMapDatTree`.
 */
export async function decodeMapTree(roots: SourceRoots): Promise<MapInfo[]> {
  const found = excludeStringTableCopies(await collectSourceFilesNamed(roots, MAP_CIF_FILE));
  const maps: MapInfo[] = [];
  for (const { rel, path } of found) {
    try {
      const bytes = await readFile(path);
      const provenance = mapProvenance(rel);
      const layer = provenance.kind === 'mod' ? 'mod' : 'base';
      maps.push(mapCifToInfo(bytes, mapIdFromPath(rel), { file: rel, layer }, provenance));
    } catch (err) {
      console.warn(`[pipeline] skipped map ${rel}: ${errorMessage(err)}`);
    }
  }
  return maps;
}
