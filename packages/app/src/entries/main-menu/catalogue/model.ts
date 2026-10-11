import {
  type CatalogConvertedMap,
  type CatalogEntry,
  MAP_TEXT_LANGUAGES,
  MAP_TYPE,
  type MapsIndexEntry,
  type MapTextLanguage,
} from '@open-northland/data';
import { convertedMaps, type InstalledMapRecord } from '../../../content/map-source/index.js';

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

export type MapSize = 'small' | 'medium' | 'large';
export const MAP_SIZES: readonly MapSize[] = ['small', 'medium', 'large'];

/** The largest cell areas a small and a medium map have, as squares of 120 and 200 cells a side. The
 *  shipped maps run from 50x50 to 500x500, most of them 250x250. */
export const SMALL_MAP_MAX_CELLS = 120 * 120;
export const MEDIUM_MAP_MAX_CELLS = 200 * 200;

export function mapSize(cells: CatalogConvertedMap['cells']): MapSize {
  const area = cells.width * cells.height;
  return area <= SMALL_MAP_MAX_CELLS ? 'small' : area <= MEDIUM_MAP_MAX_CELLS ? 'medium' : 'large';
}

export interface CatalogueRow {
  readonly entry: CatalogEntry;
  /** The server's converted maps for this entry; empty until it converted them. */
  readonly maps: readonly CatalogConvertedMap[];
  /** The listing row of the map the card shows and a player starts: the server's main map, else the
   *  installed one. */
  readonly mainIndex: MapsIndexEntry | null;
  /** The pack's other maps, installed with the main one. */
  readonly subMapCount: number;
  readonly status: CatalogueStatus;
  /** The installed main map's id while it can be played. */
  readonly playableMapId: string | null;
  /** The installed main map's listing row, which Play and Choose start. */
  readonly playableIndex: MapsIndexEntry | null;
  /** Every seat count a map of the pack offers, ascending. */
  readonly playerCounts: readonly number[];
  /** Every language a map of the pack carries, in `MAP_TEXT_LANGUAGES` order. */
  readonly languages: readonly MapTextLanguage[];
  /** The main map's size; null until the server converted the entry. */
  readonly size: MapSize | null;
}

/**
 * The map a pack starts from: the one without a campaign slot, else the first that is not a
 * campaign-only sub map, else the first. The card shows it and counts the rest.
 */
export function mainCatalogMap<T extends { readonly index: MapsIndexEntry }>(maps: readonly T[]): T | null {
  return (
    maps.find((map) => map.index.campaign === undefined) ??
    maps.find((map) => !(map.index.mapTypes ?? []).includes(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN)) ??
    maps[0] ??
    null
  );
}

/** The seats a player could take on a map. */
export function playerCount(index: MapsIndexEntry | null): number {
  return index?.players?.filter((slot) => !slot.hidden).length ?? 0;
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

function packFacts(maps: readonly CatalogConvertedMap[]) {
  const counts = new Set(maps.map((map) => playerCount(map.index)).filter((count) => count > 0));
  const languages = new Set(maps.flatMap((map) => map.languages));
  return {
    playerCounts: [...counts].sort((a, b) => a - b),
    languages: MAP_TEXT_LANGUAGES.filter((language) => languages.has(language)),
  };
}

/** One row per entry, its status joined from the server's conversion and the installed maps. */
export function catalogueRow(
  entry: CatalogEntry,
  installed: readonly InstalledMapRecord[],
  irVersion: number,
): CatalogueRow {
  const maps = convertedMaps(entry);
  const current = installed.filter((record) => record.entryId === entry.id && record.irVersion === irVersion);
  const served = serverStatus(entry, irVersion);
  const installedMain = mainCatalogMap(current);
  const serverMain = mainCatalogMap(maps);
  const facts = packFacts(maps);
  const base = {
    entry,
    maps,
    mainIndex: serverMain?.index ?? installedMain?.index ?? null,
    subMapCount: Math.max(0, (maps.length > 0 ? maps.length : current.length) - 1),
    size: serverMain === null ? null : mapSize(serverMain.cells),
    ...facts,
  };
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
      ...base,
      status: differs ? 'updatable' : 'installed',
      playableMapId: installedMain.mapId,
      playableIndex: installedMain.index,
    };
  }
  const installedElsewhere = installed.some((record) => record.entryId === entry.id);
  const status = installedElsewhere && served === 'available' ? 'redownload' : served;
  return { ...base, status, playableMapId: null, playableIndex: null };
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

/** Whether a player can have the entry on this build: installed and playable, or downloadable. */
export function isReady(row: CatalogueRow): boolean {
  return row.playableMapId !== null || canDownload(row.status);
}

/** One installed catalogue entry as the Installed tab lists it: its maps on disk, and the catalogue's
 *  row when the catalogue still lists the entry. */
export interface InstalledGroup {
  readonly entryId: string;
  readonly records: readonly InstalledMapRecord[];
  readonly row: CatalogueRow | null;
  /** Bytes of every stored file of the entry. */
  readonly bytes: number;
  readonly installedAt: number;
}

/** The installed entries, the most recently installed first. */
export function installedGroups(
  records: readonly InstalledMapRecord[],
  rows: readonly CatalogueRow[],
): readonly InstalledGroup[] {
  const byEntry = new Map<string, InstalledMapRecord[]>();
  for (const record of records) {
    const group = byEntry.get(record.entryId);
    if (group === undefined) byEntry.set(record.entryId, [record]);
    else group.push(record);
  }
  const rowOf = new Map(rows.map((row) => [row.entry.id, row]));
  return [...byEntry]
    .map(([entryId, own]) => ({
      entryId,
      records: own,
      row: rowOf.get(entryId) ?? null,
      bytes: own.reduce((sum, record) => sum + record.size, 0),
      installedAt: Math.max(...own.map((record) => record.installedAt)),
    }))
    .sort((a, b) => b.installedAt - a.installedAt || (a.entryId < b.entryId ? -1 : 1));
}
