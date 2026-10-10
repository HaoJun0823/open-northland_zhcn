import { dirname } from 'node:path';
import type { MapProvenance } from '@open-northland/data';
import type { MapProvenanceKind } from '@open-northland/map-import';

/** `CnModMaps/` and `DataCnmd/` are the mod's own maps and `UserMaps/` the player's; loose `Data/maps`
 *  can hold anything a game install accumulated, so a map there stays `unknown`. */
export function mapProvenanceKind(folder: string): MapProvenanceKind {
  const head = folder.toLowerCase().split('/')[0];
  if (head === 'usermaps') return 'user';
  if (head === 'cnmodmaps' || head === 'datacnmd') return 'mod';
  return 'unknown';
}

/** The provenance of the map whose file sits at mod-relative `rel`. */
export function mapProvenance(rel: string): MapProvenance {
  const folder = dirname(rel);
  return { kind: mapProvenanceKind(folder), folder };
}
