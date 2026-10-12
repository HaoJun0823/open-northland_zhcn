import type { MapBriefing } from '@open-northland/data';
import { hypertextPictureUrl } from '../gui-gfx.js';
import { isMapFileSuffix, mapFilePath } from './files.js';
import { findMapSource } from './sources.js';

/** Resolve only this world's local pictures. Blob URLs live as long as its presentation. */
export async function mapBriefingPictures(mapId: string | null, briefing: MapBriefing | null) {
  const urls = new Map<string, string>();
  const dispose = (): void => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  const result = { url: (file: string) => urls.get(file) ?? hypertextPictureUrl(file), dispose };
  if (mapId === null || briefing === null) return result;
  const source = await findMapSource(mapId);
  if (source?.local === undefined || source.stale) return result;
  const names = new Set(
    Object.values(briefing.texts).flatMap((pages) =>
      Object.values(pages).flatMap((blocks) =>
        blocks.flatMap((block) => (block.kind === 'picture' ? [block.file] : [])),
      ),
    ),
  );
  try {
    for (const name of names) {
      const suffix = `.pictures-${name}`;
      if (!isMapFileSuffix(suffix)) continue;
      const response = await source.fetch(mapFilePath(mapId, suffix));
      if (response.ok) urls.set(name, URL.createObjectURL(await response.blob()));
    }
  } catch {
    dispose();
  }
  return result;
}
