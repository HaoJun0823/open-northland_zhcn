import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { excludeStringTableCopies, MAP_DAT_FILE, mapIdFromPath } from '@open-northland/map-import';
import { parseDataManifest, readCampaigns } from '../../../../scripts/data-pack.mjs';
import type { MapFileReader } from './map-source-text.js';
import { readCaseInsensitive } from './pack-files.js';

/** One map of the data pack, by the id the pipeline converts it under. */
export interface PackMap {
  readonly kind: 'campaign' | 'base';
  /** `<campaign>-<map>` for a campaign map (docs/DATA-PACK.md), the folder slug for a base map. */
  readonly id: string;
  /** The `map.dat` path under the pack root. */
  readonly source: string;
  readonly md5: string;
  readonly sha256: string;
  readonly read: MapFileReader;
}

const CAMPAIGNS_DIR = 'campaigns';
const COMMUNITY_MAPS_DIR = ['base', 'maps', 'community'] as const;

function digests(bytes: Uint8Array): { md5: string; sha256: string } {
  return {
    md5: createHash('md5').update(bytes).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Each campaign map, read through its `campaign.json` mapping of logical paths to pack files. */
async function campaignMaps(dataRoot: string): Promise<PackMap[]> {
  const manifest = parseDataManifest(JSON.parse(await readFile(join(dataRoot, 'manifest.json'), 'utf8')));
  const maps: PackMap[] = [];
  for (const campaign of await readCampaigns(dataRoot, manifest)) {
    for (const map of campaign.maps) {
      const mapDir = join(dataRoot, CAMPAIGNS_DIR, campaign.id, 'maps', map.id);
      const files = new Map<string, string>();
      for (const layer of [map.shared, ...Object.values(map.locales)])
        for (const [logical, file] of Object.entries(layer)) files.set(logical.toLowerCase(), file);
      const dat = files.get(MAP_DAT_FILE);
      if (dat === undefined)
        throw new Error(`${campaign.id}/${map.id}: campaign.json names no ${MAP_DAT_FILE}`);
      maps.push({
        kind: 'campaign',
        id: `${campaign.id}-${map.id}`,
        source: [CAMPAIGNS_DIR, campaign.id, 'maps', map.id, dat].join('/'),
        ...digests(await readFile(join(mapDir, dat))),
        read: async (segments) => {
          const file = files.get(segments.join('/').toLowerCase());
          return file === undefined ? undefined : readFile(join(mapDir, file));
        },
      });
    }
  }
  return maps;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Each base map folder under `base/maps/community/` holding a `map.dat`, `text/` copies excluded. */
async function baseMaps(dataRoot: string): Promise<PackMap[]> {
  const root = join(dataRoot, ...COMMUNITY_MAPS_DIR);
  const found: { rel: string; path: string }[] = [];
  for await (const path of walk(root)) {
    const rel = relative(root, path).split(sep).join('/');
    if (rel.split('/').at(-1)?.toLowerCase() === MAP_DAT_FILE) found.push({ rel, path });
  }
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const maps: PackMap[] = [];
  for (const { rel, path } of excludeStringTableCopies(found)) {
    const folder = dirname(path);
    maps.push({
      kind: 'base',
      id: mapIdFromPath(rel),
      source: [...COMMUNITY_MAPS_DIR, rel].join('/'),
      ...digests(await readFile(path)),
      read: (segments) => readCaseInsensitive(folder, segments),
    });
  }
  return maps;
}

/** Every campaign and base map of an unpacked data pack. */
export async function packMaps(dataRoot: string): Promise<PackMap[]> {
  return [...(await campaignMaps(dataRoot)), ...(await baseMaps(dataRoot))];
}
