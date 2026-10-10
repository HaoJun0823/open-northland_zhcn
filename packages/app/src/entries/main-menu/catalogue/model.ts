import {
  type CatalogCategory,
  type CatalogConvertedMap,
  type CatalogEntry,
  MAP_TYPE,
  type MapTextLanguage,
} from '@open-northland/data';
import { convertedMaps, type InstalledMapRecord } from '../../../content/map-source/index.js';
import { compareLabels } from '../../../i18n/index.js';

/** The catalogue screen's category tabs; the two series categories share one. */
export type CatalogueFilter = 'all' | 'single' | 'multi' | 'campaign' | 'series';
export const CATALOGUE_FILTERS: readonly CatalogueFilter[] = ['all', 'single', 'multi', 'campaign', 'series'];

const FILTER_OF: Readonly<Record<CatalogCategory, Exclude<CatalogueFilter, 'all'>>> = {
  single: 'single',
  multi: 'multi',
  campaign: 'campaign',
  'series-single': 'series',
  'series-multi': 'series',
};

/**
 * What a player can do with an entry:
 * - `external`: the file lives on another site; only its page opens;
 * - `failed`: the server could not convert it; the page opens with the server's reason;
 * - `pending`: the server has not converted it yet; nothing is clickable;
 * - `gameTooOld` / `serverTooOld`: converted for another content version than this build's;
 * - `available`: downloadable; `installed`: playable; `updatable`: playable, with a newer conversion;
 * - `redownload`: installed for an older content version, downloadable again.
 */
export type CatalogueStatus =
  | 'external'
  | 'failed'
  | 'pending'
  | 'gameTooOld'
  | 'serverTooOld'
  | 'available'
  | 'installed'
  | 'updatable'
  | 'redownload';

export interface CatalogueRow {
  readonly entry: CatalogEntry;
  /** The map the list shows and a player starts; absent until the server converted the entry. */
  readonly main: CatalogConvertedMap | null;
  /** The campaign's other maps, installed with the main one. */
  readonly subMapCount: number;
  readonly status: CatalogueStatus;
  /** The installed main map's id while it can be played. */
  readonly playableMapId: string | null;
}

/**
 * The map a campaign starts from: the one without a campaign slot, else the first that is not a
 * campaign-only sub map, else the first. The list shows it and counts the rest.
 */
export function mainCatalogMap(maps: readonly CatalogConvertedMap[]): CatalogConvertedMap | null {
  return (
    maps.find((map) => map.index.campaign === undefined) ??
    maps.find((map) => !(map.index.mapTypes ?? []).includes(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN)) ??
    maps[0] ??
    null
  );
}

function serverStatus(entry: CatalogEntry, irVersion: number): CatalogueStatus {
  if (entry.file.kind === 'external') return 'external';
  const conversion = entry.conversion;
  if (conversion === undefined || conversion.verdict === 'pending') return 'pending';
  if (conversion.verdict === 'failed') return 'failed';
  if (conversion.irVersion > irVersion) return 'gameTooOld';
  if (conversion.irVersion < irVersion) return 'serverTooOld';
  return 'available';
}

/** One row per entry, its status joined from the server's conversion and the installed maps. */
export function catalogueRow(
  entry: CatalogEntry,
  installed: readonly InstalledMapRecord[],
  irVersion: number,
): CatalogueRow {
  const maps = convertedMaps(entry);
  const own = installed.filter((record) => record.entryId === entry.id);
  const current = own.filter((record) => record.irVersion === irVersion);
  const served = serverStatus(entry, irVersion);
  const installedMain = mainCatalogMap(
    current.map((record) => ({
      mapId: record.mapId,
      fingerprint: record.fingerprint,
      languages: [],
      index: record.index,
    })),
  );
  const main = mainCatalogMap(maps) ?? installedMain;
  const subMapCount = Math.max(0, (maps.length > 0 ? maps.length : current.length) - 1);
  if (installedMain !== null) {
    // Playable now; a different conversion on the server for this version is an update.
    const differs =
      served === 'available' &&
      (maps.length !== current.length ||
        maps.some(
          (map) =>
            !current.some((record) => record.mapId === map.mapId && record.fingerprint === map.fingerprint),
        ));
    return {
      entry,
      main,
      subMapCount,
      status: differs ? 'updatable' : 'installed',
      playableMapId: installedMain.mapId,
    };
  }
  const status = own.length > 0 && served === 'available' ? 'redownload' : served;
  return { entry, main, subMapCount, status, playableMapId: null };
}

export function catalogueRows(
  entries: readonly CatalogEntry[],
  installed: readonly InstalledMapRecord[],
  irVersion: number,
): readonly CatalogueRow[] {
  return entries.map((entry) => catalogueRow(entry, installed, irVersion));
}

/** Whether the row offers a download: a fresh install, an update or a re-download. */
export function canDownload(status: CatalogueStatus): boolean {
  return status === 'available' || status === 'updatable' || status === 'redownload';
}

/** The rows under a tab, matching the search in title or author, sorted by title. */
export function filterCatalogueRows(
  rows: readonly CatalogueRow[],
  filter: CatalogueFilter,
  query: string,
): readonly CatalogueRow[] {
  const needle = query.trim().toLowerCase();
  const compare = compareLabels();
  return rows
    .filter(
      ({ entry }) =>
        (filter === 'all' || FILTER_OF[entry.category] === filter) &&
        (needle === '' ||
          entry.title.toLowerCase().includes(needle) ||
          entry.author.toLowerCase().includes(needle)),
    )
    .sort((a, b) => compare(a.entry.title, b.entry.title) || (a.entry.id < b.entry.id ? -1 : 1));
}

/** Short language codes as the card lists them. */
const LANGUAGE_CODES: Readonly<Record<MapTextLanguage, string>> = {
  pol: 'PL',
  eng: 'EN',
  ger: 'DE',
  rus: 'RU',
};

export function languageCodes(languages: readonly MapTextLanguage[]): string {
  return languages.map((language) => LANGUAGE_CODES[language]).join(', ');
}

/** The seats a player could take on the main map. */
export function playerCount(map: CatalogConvertedMap | null): number {
  return map?.index.players?.filter((slot) => !slot.hidden).length ?? 0;
}

/** Survives leaving the screen, so a round trip to the lobby keeps the tab, search and selection. */
export interface CatalogueMemory {
  filter: CatalogueFilter;
  query: string;
  selectedId: string | null;
}

export function initialCatalogueMemory(filter: CatalogueFilter = 'all'): CatalogueMemory {
  return { filter, query: '', selectedId: null };
}
