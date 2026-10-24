import { type MusicManifest, parseMusicManifest } from '@open-northland/audio';
import { diag } from '../../diag/index.js';
import { type ContentFetch, contentFetch } from '../url.js';

/**
 * The rendered-music fetch boundary: the pipeline's `music/manifest.json`, or null when no music was
 * rendered (a checkout without it stays silent, music-wise, and still boots).
 */
export async function loadMusicManifest(
  fetchImpl: ContentFetch = contentFetch,
): Promise<MusicManifest | null> {
  try {
    const res = await fetchImpl('/music/manifest.json');
    if (!res.ok) return null;
    const read = parseMusicManifest(await res.json());
    if (read.manifest === null) diag.warn('audio', 'music manifest rejected', { reason: read.rejected });
    return read.manifest;
  } catch {
    return null;
  }
}
