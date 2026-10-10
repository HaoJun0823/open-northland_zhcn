import { MAP_FINGERPRINT, MapsIndexEntry } from '@open-northland/data';
import { isMapId } from '../transfer/documents.js';
import { MAP_FILE_SUFFIXES, type MapFileSuffix } from './files.js';

/** The stored record layout; a reader accepts exactly this version and drops every other record. */
export const INSTALLED_MAP_RECORD_VERSION = 1;

/** The web build's budget for installed catalogue maps in IndexedDB; the least recently installed
 *  entries leave first. The desktop keeps its files on disk without a budget. */
export const MAX_INSTALLED_MAP_BYTES = 512 * 1024 * 1024;

/** One installed catalogue map: its listing row and what it was converted from and for. */
export interface InstalledMapRecord {
  readonly version: typeof INSTALLED_MAP_RECORD_VERSION;
  readonly mapId: string;
  readonly entryId: string;
  readonly fingerprint: string;
  /** The content version the files were converted for; another build lists the map for re-download. */
  readonly irVersion: number;
  /** The `maps-index.json` row, with `provenance.kind` `catalog`. */
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
    typeof r.mapId !== 'string' ||
    !isMapId(r.mapId) ||
    typeof r.entryId !== 'string' ||
    !isMapId(r.entryId) ||
    typeof r.fingerprint !== 'string' ||
    !MAP_FINGERPRINT.test(r.fingerprint) ||
    !isCount(r.irVersion) ||
    !isCount(r.installedAt) ||
    !isCount(r.size) ||
    !Array.isArray(r.suffixes) ||
    !r.suffixes.every((suffix) => MAP_FILE_SUFFIXES.some((known) => known === suffix)) ||
    !r.suffixes.includes('.json')
  )
    return null;
  const index = MapsIndexEntry.safeParse(r.index);
  if (!index.success || index.data.id !== r.mapId || index.data.provenance?.kind !== 'catalog') return null;
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    mapId: r.mapId,
    entryId: r.entryId,
    fingerprint: r.fingerprint,
    irVersion: r.irVersion,
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
}

function groups(records: readonly InstalledMapRecord[]): EntryGroup[] {
  const byEntry = new Map<string, EntryGroup>();
  for (const record of records) {
    const group = byEntry.get(record.entryId);
    byEntry.set(record.entryId, {
      entryId: record.entryId,
      installedAt: Math.max(group?.installedAt ?? 0, record.installedAt),
      size: (group?.size ?? 0) + record.size,
    });
  }
  return [...byEntry.values()];
}

/**
 * The entries the web store keeps once `incoming` (one entry's maps) is installed: whole entries, since
 * a campaign plays only with all its maps, the newest first within `budget`. Throws when the incoming
 * entry alone does not fit.
 */
export function retainedEntries(
  stored: readonly InstalledMapRecord[],
  incoming: readonly InstalledMapRecord[],
  budget: number = MAX_INSTALLED_MAP_BYTES,
): ReadonlySet<string> {
  const incomingEntries = new Set(incoming.map((record) => record.entryId));
  const [fresh] = groups(incoming);
  if (fresh === undefined) return new Set();
  if (incomingEntries.size !== 1) throw new Error('One install holds one catalogue entry');
  if (fresh.size > budget) throw new Error('Catalogue map exceeds the storage budget');
  const keep = new Set([fresh.entryId]);
  let bytes = fresh.size;
  const older = groups(stored.filter((record) => record.entryId !== fresh.entryId)).sort(
    (a, b) => b.installedAt - a.installedAt || (a.entryId < b.entryId ? -1 : 1),
  );
  for (const group of older) {
    if (bytes + group.size > budget) continue;
    keep.add(group.entryId);
    bytes += group.size;
  }
  return keep;
}
