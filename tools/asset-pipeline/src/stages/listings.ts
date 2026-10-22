import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BOB_ATLASES_PATH,
  BobAtlasSet,
  type BobsIndexEntry,
  type CampaignIndex,
  type MapsIndexEntry,
} from '@open-northland/data';
import { mapsIndexEntry } from '@open-northland/map-import';
import { statIfExists } from '../files.js';
import { BOBS_DIR, INDEXED_ATLAS_SUFFIX, writeJsonFile } from './content-tree.js';
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

/** Every viewable atlas in `bobs/atlases.json` whose sheet exists, sorted by (base, variant). */
export async function bobsIndexEntries(outDir: string): Promise<BobsIndexEntry[]> {
  const bobs = join(outDir, BOBS_DIR);
  if (!(await statIfExists(bobs))?.isDirectory()) return [];
  const names = new Set(await readdir(bobs));
  const document = join(outDir, BOB_ATLASES_PATH);
  if ((await statIfExists(document)) === undefined) return [];
  const { stems } = BobAtlasSet.parse(JSON.parse(await readFile(document, 'utf8')));
  const entries: BobsIndexEntry[] = [];
  for (const [stem, { image }] of Object.entries(stems)) {
    // An `.indexed` sheet holds a palette index in red and coverage in green, not a viewable image.
    if (stem.endsWith(`.${INDEXED_ATLAS_SUFFIX}`) || !names.has(image)) continue;
    const dot = stem.indexOf('.');
    const base = dot === -1 ? stem : stem.slice(0, dot);
    const variant = dot === -1 ? '' : stem.slice(dot + 1);
    entries.push({ stem, image, base, variant });
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
