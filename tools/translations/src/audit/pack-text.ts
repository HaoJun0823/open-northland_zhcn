import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type GameObjectNames,
  type GameObjectTable,
  historyDir,
  readBaseMapTree,
  readCampaignMapTree,
  readGameObjectNames,
  readHistoryBlocks,
  type SourceRoots,
  takesSourceLanguageOverlays,
} from '@open-northland/asset-pipeline/sources';
import { jsonFingerprint, type SourceLanguage } from '@open-northland/data';
import {
  findMapFolders,
  isMapTextFile,
  type MapSourceText,
  readMapSourceText,
} from '@open-northland/map-import';
import { type CampaignSource, parseDataManifest, readCampaigns } from '../../../../scripts/data-pack.mjs';

/** One map of the pack, as its overlays are checked against it. */
export interface PackMap {
  /** The lower-cased folder of a base map, or `campaigns/<campaign>/<map>`. */
  readonly folder: string;
  /** The campaign the map belongs to, for a campaign map. */
  readonly campaign?: string;
  /** Whether the pipeline applies a source-language overlay to it: a community map only. */
  readonly takesSourceLanguages: boolean;
  readonly text: MapSourceText;
}

/** A history book's blocks by lower-cased block file, then label. */
export type BookBlocks = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The pack's source text as it shipped, read with the pipeline's readers but without its corrections:
 *  an overlay's basis is the shipped text. */
export interface PackText {
  /** Every base and campaign map, by raw `map.dat` SHA-256; one digest can name several copies. Read
   *  on the first call, since it walks the whole pack. */
  maps(): Promise<ReadonlyMap<string, readonly PackMap[]>>;
  readonly campaigns: ReadonlySet<string>;
  /** One language's game-object table; throws when the pack lacks it or it does not decode. */
  objectNames(lang: SourceLanguage, table: GameObjectTable): Promise<GameObjectNames>;
  /** One language's history book, or undefined when the pack lacks it. */
  historyBlocks(lang: SourceLanguage): Promise<BookBlocks | undefined>;
}

/** An object table overlay's `basis.digest`: the decoded source names and plurals by type id, not normalised. */
export function objectTableSourceDigest({ names, plurals }: GameObjectNames): string {
  return jsonFingerprint({ names: { ...names }, plurals: { ...plurals } });
}

/** A book overlay's `basis.digest`: the basis language's blocks by lower-cased block file, then label. */
export function bookSourceDigest(blocks: BookBlocks): string {
  return jsonFingerprint({
    blocks: Object.fromEntries([...blocks].map(([file, labels]) => [file, Object.fromEntries(labels)])),
  });
}

function addMap(maps: Map<string, PackMap[]>, map: PackMap): void {
  const copies = maps.get(map.text.datDigest) ?? [];
  copies.push(map);
  maps.set(map.text.datDigest, copies);
}

/** The text of every base and campaign map; only map.dat and the text files are read. */
async function readPackMaps(
  roots: SourceRoots,
  dataRoot: string,
  campaigns: readonly CampaignSource[],
): Promise<Map<string, PackMap[]>> {
  const maps = new Map<string, PackMap[]>();
  const tree = await readBaseMapTree(roots, isMapTextFile);
  for (const key of findMapFolders(tree)) {
    const text = await readMapSourceText(tree, key);
    if (text !== undefined)
      addMap(maps, { folder: key, takesSourceLanguages: takesSourceLanguageOverlays(key), text });
  }
  for (const campaign of campaigns) {
    for (const map of campaign.maps) {
      const read = await readCampaignMapTree(roots, dataRoot, campaign, map, isMapTextFile);
      const text = await readMapSourceText(read.tree, read.key);
      if (text !== undefined)
        addMap(maps, { folder: read.folder, campaign: campaign.id, takesSourceLanguages: false, text });
    }
  }
  return maps;
}

/**
 * Reads the unpacked pack at `dataRoot`. The manifest and campaigns are parsed, not checksummed: the
 * pipeline validates the pack before it converts it.
 */
export async function readPackText(dataRoot: string): Promise<PackText> {
  const manifest = parseDataManifest(JSON.parse(await readFile(join(dataRoot, 'manifest.json'), 'utf8')));
  const roots: SourceRoots = { data: join(dataRoot, 'base') };
  const campaigns = await readCampaigns(dataRoot, manifest);
  let maps: Promise<Map<string, PackMap[]>> | undefined;
  return {
    maps: () => {
      maps ??= readPackMaps(roots, dataRoot, campaigns);
      return maps;
    },
    campaigns: new Set(campaigns.map((campaign) => campaign.id)),
    objectNames: (lang, table) => readGameObjectNames(roots, lang, table),
    historyBlocks: async (lang) => {
      const dir = await historyDir(roots, lang);
      return dir === undefined ? undefined : readHistoryBlocks(dir, lang);
    },
  };
}
