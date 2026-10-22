import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BobsIndexEntry, CampaignIndex, MapsIndexEntry } from '@open-northland/data';
import { mapsIndexEntry } from '@open-northland/map-import';
import type { AtlasManifest } from '@open-northland/render';
import { statIfExists } from '../files.js';
import { ATLAS_MANIFEST_SUFFIX, BOBS_DIR, INDEXED_ATLAS_SUFFIX, writeJsonFile } from './content-tree.js';
import type { MapDatConversion } from './maps/index.js';

export const MAPS_INDEX_FILE = 'maps-index.json';
export const BOBS_INDEX_FILE = 'bobs-index.json';
export const CAMPAIGNS_INDEX_FILE = 'campaigns-index.json';

/** Code-unit order: the one string order every JavaScript host agrees on. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One entry per converted map id, the last conversion of a repeated id winning like its files did. */
export function mapsIndexEntries(maps: readonly MapDatConversion[]): MapsIndexEntry[] {
  const byId = new Map<string, MapsIndexEntry>();
  for (const map of maps) byId.set(map.id, mapsIndexEntry(map));
  return [...byId.values()].sort((a, b) => byCodeUnit(a.id, b.id));
}

/** Every viewable atlas under `bobs/`: a `<stem>.atlas.json` whose sheet exists, sorted by (base, variant). */
export async function bobsIndexEntries(outDir: string): Promise<BobsIndexEntry[]> {
  const bobs = join(outDir, BOBS_DIR);
  if (!(await statIfExists(bobs))?.isDirectory()) return [];
  const names = new Set(await readdir(bobs));
  const stems = [...names]
    .filter((name) => name.endsWith(ATLAS_MANIFEST_SUFFIX))
    .map((name) => name.slice(0, -ATLAS_MANIFEST_SUFFIX.length))
    // An `.indexed` sheet holds a palette index in red and coverage in green, not a viewable image.
    .filter((stem) => !stem.endsWith(`.${INDEXED_ATLAS_SUFFIX}`));
  const entries: BobsIndexEntry[] = [];
  for (const stem of stems) {
    const manifest = JSON.parse(
      await readFile(join(bobs, `${stem}${ATLAS_MANIFEST_SUFFIX}`), 'utf8'),
    ) as Pick<AtlasManifest, 'image'>;
    if (!names.has(manifest.image)) continue;
    const dot = stem.indexOf('.');
    const base = dot === -1 ? stem : stem.slice(0, dot);
    const variant = dot === -1 ? '' : stem.slice(dot + 1);
    entries.push({ stem, image: manifest.image, base, variant });
  }
  return entries.sort((a, b) => byCodeUnit(a.base, b.base) || byCodeUnit(a.variant, b.variant));
}

/** Writes the listings the app reads instead of scanning the tree. */
export async function writeListings(
  outDir: string,
  maps: readonly MapDatConversion[],
  campaigns: CampaignIndex,
): Promise<void> {
  await writeJsonFile(outDir, MAPS_INDEX_FILE, mapsIndexEntries(maps));
  await writeJsonFile(outDir, BOBS_INDEX_FILE, await bobsIndexEntries(outDir));
  await writeJsonFile(outDir, CAMPAIGNS_INDEX_FILE, campaigns);
}
