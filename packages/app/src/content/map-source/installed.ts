import { isLanguage, MAP_FINGERPRINT, MapsIndexEntry, type MapTextLanguage } from '@open-northland/data';
import type { LocalSourceRecord } from '../local-import/source.js';
import { isMapId } from '../transfer/documents.js';
import { isMapFileSuffix, type MapFileSuffix } from './files.js';

/** The stored record layout; a reader accepts exactly this version and drops every other record. */
export const INSTALLED_MAP_RECORD_VERSION = 3;

/** The web budget includes retained sources. Only catalogue downloads are evictable; local maps
 *  stay until removed. The desktop keeps its files on disk without an aggregate budget. */
export const MAX_INSTALLED_MAP_BYTES = 512 * 1024 * 1024;

/** One installed catalogue or user map: its listing row and what it was converted from and for. */
export interface InstalledMapRecord {
  readonly version: typeof INSTALLED_MAP_RECORD_VERSION;
  /** Identifies this exact installation, including sidecars outside the playable fingerprint. */
  readonly revision: string;
  readonly mapId: string;
  readonly entryId: string;
  readonly fingerprint: string;
  /** The content version the files were converted for; another build rebuilds from its source or downloads it again. */
  readonly irVersion: number;
  /** The stored string table's languages, as the catalogue listed them for a download; a catalogue map
   *  that gained or lost one since (a translation overlay) is an update. */
  readonly languages: readonly MapTextLanguage[];
  /** The `maps-index.json` row, with its `catalog` or `user` provenance. */
  readonly index: MapsIndexEntry;
  readonly installedAt: number;
  /** The bytes of every stored file. */
  readonly size: number;
  readonly suffixes: readonly MapFileSuffix[];
}

/** One map's downloaded files, ready to store. */
export interface InstallableMap {
  readonly record: InstalledMapRecord;
  readonly files: ReadonlyMap<MapFileSuffix, Uint8Array>;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A stored record this build reads, or null. */
export function installedRecord(raw: unknown): InstalledMapRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    r.version !== INSTALLED_MAP_RECORD_VERSION ||
    typeof r.revision !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.revision) ||
    typeof r.mapId !== 'string' ||
    !isMapId(r.mapId) ||
    typeof r.entryId !== 'string' ||
    !isMapId(r.entryId) ||
    typeof r.fingerprint !== 'string' ||
    !MAP_FINGERPRINT.test(r.fingerprint) ||
    !isCount(r.irVersion) ||
    !Array.isArray(r.languages) ||
    !r.languages.every(isLanguage) ||
    !isCount(r.installedAt) ||
    !isCount(r.size) ||
    !Array.isArray(r.suffixes) ||
    !r.suffixes.every(isMapFileSuffix) ||
    !r.suffixes.includes('.json')
  )
    return null;
  const index = MapsIndexEntry.safeParse(r.index);
  if (
    !index.success ||
    index.data.id !== r.mapId ||
    (index.data.provenance?.kind !== 'catalog' && index.data.provenance?.kind !== 'user')
  )
    return null;
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    revision: r.revision,
    mapId: r.mapId,
    entryId: r.entryId,
    fingerprint: r.fingerprint,
    irVersion: r.irVersion,
    languages: r.languages as MapTextLanguage[],
    index: index.data,
    installedAt: r.installedAt,
    size: r.size,
    suffixes: r.suffixes as MapFileSuffix[],
  };
}

interface EntryGroup {
  readonly entryId: string;
  readonly installedAt: number;
  readonly size: number;
  readonly protected: boolean;
}

function groups(records: readonly InstalledMapRecord[]): EntryGroup[] {
  const byEntry = new Map<string, EntryGroup>();
  for (const record of records) {
    const group = byEntry.get(record.entryId);
    byEntry.set(record.entryId, {
      entryId: record.entryId,
      installedAt: Math.max(group?.installedAt ?? 0, record.installedAt),
      size: (group?.size ?? 0) + record.size,
      protected: group?.protected === true || record.index.provenance?.kind === 'user',
    });
  }
  return [...byEntry.values()];
}

export class MapStorageFullError extends Error {
  constructor(
    readonly requiredBytes: number,
    readonly availableBytes: number,
  ) {
    super('Not enough space in the map storage budget');
    this.name = 'MapStorageFullError';
  }
}

/** Local sources and their maps are never evicted. Downloaded packs leave oldest first. */
export function retainedEntries(
  stored: readonly InstalledMapRecord[],
  incoming: readonly InstalledMapRecord[],
  budget: number = MAX_INSTALLED_MAP_BYTES,
  sources: readonly LocalSourceRecord[] = [],
  source?: LocalSourceRecord,
): ReadonlySet<string> {
  const incomingEntries = new Set(incoming.map((record) => record.entryId));
  const [fresh] = groups(incoming);
  if (fresh === undefined || incomingEntries.size !== 1) throw new Error('One install holds one entry');
  const incomingSize = fresh.size + (source?.size ?? 0);
  const older = new Map(
    groups(stored.filter((record) => record.entryId !== fresh.entryId)).map((group) => [
      group.entryId,
      group,
    ]),
  );
  for (const item of sources) {
    if (item.entryId === fresh.entryId) continue;
    const group = older.get(item.entryId);
    older.set(item.entryId, {
      entryId: item.entryId,
      installedAt: group?.installedAt ?? 0,
      size: (group?.size ?? 0) + item.size,
      protected: true,
    });
  }
  const keep = new Set([fresh.entryId]);
  let protectedBytes = 0;
  for (const group of older.values())
    if (group.protected) {
      keep.add(group.entryId);
      protectedBytes += group.size;
    }
  const available = Math.max(0, budget - protectedBytes);
  if (incomingSize > available) throw new MapStorageFullError(incomingSize, available);
  let bytes = protectedBytes + incomingSize;
  const evictable = [...older.values()]
    .filter((group) => !group.protected)
    .sort((a, b) => b.installedAt - a.installedAt || (a.entryId < b.entryId ? -1 : 1));
  for (const group of evictable) {
    if (bytes + group.size > budget) continue;
    keep.add(group.entryId);
    bytes += group.size;
  }
  return keep;
}
