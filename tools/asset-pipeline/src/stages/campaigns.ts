import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type Campaign,
  CampaignIndex,
  type LocalizedText,
  MAP_TEXT_LANGUAGES,
  type MapTextLanguage,
} from '@open-northland/data';
import {
  type ConvertedMap,
  convertMapFolder,
  findMapFolders,
  type MapDatTerrainFile,
  mapFiles,
  NO_IMPORT_LIMITS,
  treeFromFolder,
} from '@open-northland/map-import';
import type { CampaignFilmSource, CampaignSource } from '../../../../scripts/data-pack.mjs';
import { writeFileWithParents } from '../files.js';
import type { SourceRoots } from '../roots.js';
import { correctMapStrings } from '../string-corrections.js';
import { MAPS_DIR } from './content-tree.js';
import { writePagePictures } from './hypertext-pictures.js';
import { type MapDatConversion, summarizeConversion } from './maps/index.js';

/** Served at `/campaigns/<id>/`, the root `campaigns-index.json` names its pictures and films under. */
export const CAMPAIGNS_DIR = 'campaigns';
const CAMPAIGN_INDEX_VERSION = 3;

/** Where the pack keeps its campaigns, beside the base tree. */
const PACK_CAMPAIGNS_DIR = 'campaigns';

export interface CampaignStageResult {
  readonly maps: readonly MapDatConversion[];
  readonly index: CampaignIndex;
}

/** A campaign map keeps its pack folder name under a campaign prefix, so two games' slots never collide. */
export function campaignMapId(campaignId: string, mapId: string): string {
  return `${campaignId}-${mapId}`;
}

/** Converts one map from its shared files and every language layer, all languages in one map. */
async function convertCampaignMap(
  roots: SourceRoots,
  packRoot: string,
  campaign: CampaignSource,
  map: CampaignSource['maps'][number],
  synthesizeMinimap: ((terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>) | undefined,
): Promise<ConvertedMap> {
  const folder = `${PACK_CAMPAIGNS_DIR}/${campaign.id}/${map.id}`;
  const mapDir = join(packRoot, PACK_CAMPAIGNS_DIR, campaign.id, 'maps', map.id);
  const sources = new Map<string, string>();
  for (const files of [map.shared, ...Object.values(map.locales)])
    for (const [logical, source] of Object.entries(files)) sources.set(`${folder}/${logical}`, source);
  const tree = await treeFromFolder(
    sources.keys(),
    (rel) => readFile(join(mapDir, sources.get(rel) ?? rel)),
    NO_IMPORT_LIMITS,
  );
  const [key, ...others] = findMapFolders(tree);
  if (key === undefined || others.length > 0) throw new Error(`${folder}: expected exactly one map folder`);
  const stringCorrections = roots.mapStringCorrections;
  const converted = await convertMapFolder(tree, key, {
    id: campaignMapId(campaign.id, map.id),
    provenance: 'mod',
    limits: NO_IMPORT_LIMITS,
    ...(synthesizeMinimap === undefined ? {} : { minimap: synthesizeMinimap }),
    ...(stringCorrections === undefined
      ? {}
      : { correctStrings: (id, tables) => correctMapStrings(stringCorrections, id, tables) }),
    onWarning: (message) => console.warn(`[pipeline] ${message}`),
  });
  if (converted.meta.campaign?.campaignId !== campaign.campaignId)
    throw new Error(
      `${folder}: map.cif names campaign ${converted.meta.campaign?.campaignId}, not ${campaign.campaignId}`,
    );
  return converted;
}

/** Copies one pack file of the campaign into `campaigns/<id>/` and returns the URL the app fetches it at. */
async function publish(packRoot: string, outDir: string, campaignId: string, file: string): Promise<string> {
  const target = join(outDir, CAMPAIGNS_DIR, campaignId, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(packRoot, PACK_CAMPAIGNS_DIR, campaignId, file), target);
  return `/${CAMPAIGNS_DIR}/${campaignId}/${file}`;
}

/** A stage's title is its map's name in the campaign's languages. */
function stageTitle(map: ConvertedMap, languages: readonly MapTextLanguage[]): LocalizedText {
  return Object.fromEntries(
    languages.flatMap((language) => {
      const name = map.index.name?.[language]?.trim();
      return name ? [[language, name]] : [];
    }),
  );
}

async function convertCampaign(
  roots: SourceRoots,
  packRoot: string,
  outDir: string,
  campaign: CampaignSource,
  synthesizeMinimap: ((terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>) | undefined,
): Promise<{ readonly entry: Campaign; readonly maps: readonly ConvertedMap[] }> {
  const maps: ConvertedMap[] = [];
  for (const map of campaign.maps) {
    const converted = await convertCampaignMap(roots, packRoot, campaign, map, synthesizeMinimap);
    for (const [name, data] of mapFiles(converted))
      await writeFileWithParents(join(outDir, MAPS_DIR, name), data);
    await writePagePictures(outDir, converted.pictures);
    maps.push(converted);
  }
  const asset = (file: string): Promise<string> => publish(packRoot, outDir, campaign.id, file);
  const film = async (source: CampaignFilmSource) => ({
    url: await asset(source.video),
    audio: await asset(source.audio),
    width: source.width,
    height: source.height,
  });

  const stages: Campaign['stages'][number][] = [];
  for (const stage of campaign.stages) {
    const map = maps.find((candidate) => candidate.meta.campaign?.missionId === stage.missionId);
    if (map === undefined) throw new Error(`${campaign.id}: no map for mission ${stage.missionId}`);
    const { route } = stage;
    stages.push({
      mapId: map.id,
      title: stageTitle(map, campaign.languages),
      x: stage.x,
      y: stage.y,
      ...(route === undefined
        ? {}
        : {
            route: {
              url: await asset(route.file),
              x: route.x,
              y: route.y,
              width: route.width,
              height: route.height,
            },
          }),
    });
  }
  const logo: Partial<Record<MapTextLanguage, string>> = {};
  const movies: Campaign['movies'] = {};
  for (const language of MAP_TEXT_LANGUAGES) {
    const file = campaign.logo?.[language];
    if (file !== undefined) logo[language] = await asset(file);
    const films = campaign.movies[language];
    if (films === undefined) continue;
    movies[language] = {
      ...(films.intro === undefined ? {} : { intro: await film(films.intro) }),
      videos: await Promise.all(
        films.videos.map(async (video) => ({ ...(await film(video)), sequence: video.sequence })),
      ),
    };
  }
  return {
    entry: {
      id: campaign.id,
      campaignId: campaign.campaignId,
      order: campaign.order,
      title: campaign.title,
      languages: [...campaign.languages],
      maps: maps.map((map) => {
        const missionId = map.meta.campaign?.missionId;
        if (missionId === undefined) throw new Error(`${map.id}: no mission slot`);
        return { id: map.id, missionId };
      }),
      stages,
      background: await asset(campaign.background),
      ...(Object.keys(logo).length === 0 ? {} : { logo }),
      movies,
    },
    maps,
  };
}

/**
 * Converts the pack's campaigns: their maps into `maps/` beside the base maps, their pictures and films
 * into `campaigns/<id>/`, and the index the campaign screen reads. A campaign map whose id a base map
 * already uses fails the run. This stage is the only writer under `campaigns/`.
 */
export async function convertCampaignStage(
  roots: SourceRoots,
  packRoot: string,
  campaigns: readonly CampaignSource[],
  outDir: string,
  baseMapIds: ReadonlySet<string>,
  synthesizeMinimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>,
): Promise<CampaignStageResult> {
  await rm(join(outDir, CAMPAIGNS_DIR), { recursive: true, force: true });
  const entries: Campaign[] = [];
  const done: MapDatConversion[] = [];
  for (const campaign of campaigns) {
    for (const map of campaign.maps) {
      const id = campaignMapId(campaign.id, map.id);
      if (baseMapIds.has(id)) throw new Error(`campaign map ${id} collides with a base map`);
    }
    const { entry, maps } = await convertCampaign(roots, packRoot, outDir, campaign, synthesizeMinimap);
    entries.push(entry);
    done.push(...maps.map(summarizeConversion));
  }
  return { maps: done, index: CampaignIndex.parse({ version: CAMPAIGN_INDEX_VERSION, campaigns: entries }) };
}
