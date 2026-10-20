import { dirname } from 'node:path';
import type { MapProvenance } from '@open-northland/data';
import type { MapProvenanceKind } from '@open-northland/map-import';

/** `maps/community/` and `extras/` are the mod's own maps and `UserMaps/` the player's; loose `Data/maps`
 *  can hold anything a game install accumulated, so a map there stays `unknown`. */
export function mapProvenanceKind(folder: string): MapProvenanceKind {
  const head = folder.toLowerCase().split('/')[0];
  if (head === 'usermaps') return 'user';
  if (folder.toLowerCase().startsWith('maps/community/') || head === 'extras') return 'mod';
  return 'unknown';
}

/** The original game's tutorials, which the mod bundles under `maps/community/`: their text is the
 *  original's, so its edits stay pipeline corrections. */
const ORIGINAL_TUTORIAL_FOLDERS: ReadonlySet<string> = new Set(
  ['001', '002', '003', '004', '005', '006', '007'].map((n) => `maps/community/tutorial_${n}`),
);

/** Whether a source-language translation overlay may apply to the map in `folder`: a community map's
 *  text is the pack's to edit; a loose map's, and an original tutorial's, is the original's. */
export function takesSourceLanguageOverlays(folder: string): boolean {
  const normalized = folder.toLowerCase().replace(/\/+$/, '');
  return mapProvenanceKind(normalized) !== 'unknown' && !ORIGINAL_TUTORIAL_FOLDERS.has(normalized);
}

/** The provenance of the map whose file sits at mod-relative `rel`. */
export function mapProvenance(rel: string): MapProvenance {
  const folder = dirname(rel);
  return { kind: mapProvenanceKind(folder), folder };
}
