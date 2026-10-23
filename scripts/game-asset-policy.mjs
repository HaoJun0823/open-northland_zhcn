import { basename, extname } from 'node:path';

/** Extensions only original game material carries; nothing with one of these may be committed. */
const forbiddenGameExtensions = new Set([
  '.bmd',
  '.cif',
  '.cur',
  '.dll',
  '.dls',
  '.exe',
  '.fnt',
  '.hlt',
  '.lib',
  '.pcx',
  '.sgt',
  '.wav',
]);

/** True for a name that may never be committed, whatever it holds. */
export function isForbiddenGameFile(name) {
  const lower = name.toLowerCase();
  return forbiddenGameExtensions.has(extname(lower)) || basename(lower) === 'map.dat';
}

/**
 * Binary types that may be project-owned but may also be decoded game material (sheets, clips, sound
 * banks), so each committed file needs a reviewed allowlist entry.
 */
const reviewRequiredExtensions = new Set([
  '.bin',
  '.blend',
  '.bmp',
  '.exr',
  '.fbx',
  '.flac',
  '.gif',
  '.glb',
  '.gz',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.ogg',
  '.opus',
  '.otf',
  '.png',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2',
]);

/** True for a name that may be committed only once reviewed. */
export function isReviewRequiredFile(name) {
  return reviewRequiredExtensions.has(extname(name.toLowerCase()));
}
