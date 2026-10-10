import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A map id names a file on every peer, so it is one plain ASCII token (the app's `isMapId`). */
const INSTALLED_MAP_ID = /^[a-z0-9_-]{1,128}$/i;

/** The sidecars a converted map ships, longest first so `.meta.json` is not read as `.json`. */
export const INSTALLED_MAP_SUFFIXES = [
  '.briefing.json',
  '.strings.json',
  '.script.json',
  '.meta.json',
  '.json',
  '.png',
] as const;
export type InstalledMapSuffix = (typeof INSTALLED_MAP_SUFFIXES)[number];

/** The app's own cap on one map document; a picture is far smaller. */
export const MAX_INSTALLED_MAP_FILE_BYTES = 64 * 1024 * 1024;

const MAPS_ROUTE = '/maps/';

export interface InstalledMapFileWrite {
  readonly mapId: string;
  readonly suffix: InstalledMapSuffix;
  readonly bytes: Uint8Array;
}

export function parseInstalledMapId(value: unknown): string {
  if (typeof value !== 'string' || !INSTALLED_MAP_ID.test(value)) throw new Error('Invalid map id');
  return value;
}

/** The renderer's write request, checked before anything touches the disk. */
export function parseInstalledMapFileWrite(
  mapId: unknown,
  suffix: unknown,
  bytes: unknown,
): InstalledMapFileWrite {
  const id = parseInstalledMapId(mapId);
  const known = INSTALLED_MAP_SUFFIXES.find((candidate) => candidate === suffix);
  if (known === undefined) throw new Error('Invalid map file suffix');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Invalid map file bytes');
  if (bytes.byteLength > MAX_INSTALLED_MAP_FILE_BYTES) throw new Error('Map file exceeds the size limit');
  return { mapId: id, suffix: known, bytes };
}

/** Writes beside the target and renames, so a served file is never half written. */
export async function writeInstalledMapFile(root: string, write: InstalledMapFileWrite): Promise<void> {
  const folder = join(root, write.mapId);
  const target = join(folder, `${write.mapId}${write.suffix}`);
  await mkdir(folder, { recursive: true });
  const partial = `${target}.partial`;
  await writeFile(partial, write.bytes);
  await rename(partial, target);
}

export async function removeInstalledMap(root: string, mapId: string): Promise<void> {
  await rm(join(root, parseInstalledMapId(mapId)), { recursive: true, force: true });
}

/** The path under the installed-maps root that a `/maps/<mapId><suffix>` request names, or undefined
 *  for any other request. */
export function installedMapPath(pathname: string): string | undefined {
  if (!pathname.startsWith(MAPS_ROUTE)) return undefined;
  const name = pathname.slice(MAPS_ROUTE.length);
  const suffix = INSTALLED_MAP_SUFFIXES.find((candidate) => name.endsWith(candidate));
  if (suffix === undefined) return undefined;
  const mapId = name.slice(0, -suffix.length);
  if (!INSTALLED_MAP_ID.test(mapId)) return undefined;
  return `/${mapId}/${mapId}${suffix}`;
}
