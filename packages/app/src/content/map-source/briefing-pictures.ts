import type { MapBriefing } from '@open-northland/data';
import { hypertextPictureUrl } from '../gui/gfx.js';
import { briefingPictureSuffixes, mapFilePath } from './files.js';
import { findMapSource } from './sources.js';

/** Resolve only this world's installed pictures. Blob URLs live as long as its presentation. */
export async function mapBriefingPictures(mapId: string | null, briefing: MapBriefing | null) {
  const urls = new Map<string, string>();
  const dispose = (): void => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  const result = { url: (file: string) => urls.get(file) ?? hypertextPictureUrl(file), dispose };
  if (mapId === null || briefing === null) return result;
  const source = await findMapSource(mapId);
  if (source === null || (source.local === undefined && source.catalog === undefined) || source.stale)
    return result;
  try {
    for (const suffix of briefingPictureSuffixes(briefing)) {
      const name = suffix.slice('.pictures-'.length);
      const response = await source.fetch(mapFilePath(mapId, suffix));
      if (response.ok) urls.set(name, URL.createObjectURL(await response.blob()));
    }
  } catch {
    dispose();
  }
  return result;
}
