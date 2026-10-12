import {
  type CatalogEntry,
  MapBriefing,
  MapMeta,
  MapStrings,
  type MapsIndexEntry,
} from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import type { CatalogMapAnnouncement } from '@open-northland/net-protocol';
import {
  loadVerifiedMapDocuments,
  MAX_MAP_DOCUMENT_BYTES,
  type VerifiedMapDocuments,
  verifyMapDocuments,
} from '../transfer/documents.js';
import { apiBaseUrl, catalogSidecarUrl, convertedMaps, fetchCatalogEntry } from './api.js';
import { MAP_FILE_SUFFIXES, type MapFileSuffix } from './files.js';
import { INSTALLED_MAP_RECORD_VERSION, type InstallableMap, type InstalledMapRecord } from './installed.js';
import { type InstalledMapStore, installedMapStore } from './store.js';

/** A map's authored picture is a menu illustration; anything near this size is not one. */
export const MAX_MAP_PICTURE_BYTES = 16 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const TERRAIN: MapFileSuffix = '.json';
const SCRIPT: MapFileSuffix = '.script.json';
const PICTURE: MapFileSuffix = '.png';
const HTTP_NOT_FOUND = 404;

export type CatalogInstallFailure = 'notConverted' | 'otherVersion' | 'download' | 'verify';

export class CatalogInstallError extends Error {
  constructor(
    readonly failure: CatalogInstallFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Files fetched so far out of every sidecar the entry's maps may have. */
export interface InstallProgress {
  readonly done: number;
  readonly total: number;
}

export interface InstallOptions {
  readonly api: string;
  readonly store: InstalledMapStore;
  readonly fetchImpl?: typeof fetch;
  readonly irVersion?: number;
  readonly onProgress?: (progress: InstallProgress) => void;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

async function readCapped(response: Response, cap: number, url: string): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > cap)
    throw new CatalogInstallError('download', `${url} exceeds the size limit`);
  if (response.body === null) throw new CatalogInstallError('download', `${url} is empty`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) throw new CatalogInstallError('download', `${url} exceeds the size limit`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function json(bytes: Uint8Array, url: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CatalogInstallError('verify', `${url} is not JSON`);
  }
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/** Checks one sidecar the way the loaders will read it, so a stored map never fails at boot. */
function checkSidecar(suffix: MapFileSuffix, bytes: Uint8Array, url: string): void {
  if (suffix === PICTURE) {
    if (!isPng(bytes)) throw new CatalogInstallError('verify', `${url} is not a PNG`);
    return;
  }
  const value = json(bytes, url);
  const parsed =
    suffix === '.meta.json'
      ? MapMeta.safeParse(value)
      : suffix === '.strings.json'
        ? MapStrings.safeParse(value)
        : suffix === '.briefing.json'
          ? MapBriefing.safeParse(value)
          : null;
  if (parsed !== null && !parsed.success)
    throw new CatalogInstallError('verify', `${url} does not match this build`);
}

/** The catalogue map's listing row as the game lists it: its own id and the catalogue provenance. */
function installedIndex(entry: CatalogEntry, mapId: string, index: MapsIndexEntry): MapsIndexEntry {
  const folder = index.provenance?.folder ?? entry.id;
  return { ...index, id: mapId, provenance: { kind: 'catalog', folder } };
}

/**
 * Downloads every map of a converted catalogue entry, checks each file against what the server
 * announced (the fingerprint, the schemas, the size caps), and stores the entry as one install. A
 * campaign installs its main map with its sub maps.
 */
export async function installCatalogEntry(
  entry: CatalogEntry,
  options: InstallOptions,
): Promise<readonly InstalledMapRecord[]> {
  const irVersion = options.irVersion ?? IR_VERSION;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (entry.conversion?.verdict !== 'ok')
    throw new CatalogInstallError('notConverted', `${entry.id} has no converted maps`);
  if (entry.conversion.irVersion !== irVersion)
    throw new CatalogInstallError('otherVersion', `${entry.id} was converted for another game version`);
  const maps = convertedMaps(entry);
  const total = maps.length * MAP_FILE_SUFFIXES.length;
  let done = 0;
  options.onProgress?.({ done, total });
  const installedAt = (options.now ?? Date.now)();
  const installable: InstallableMap[] = [];
  for (const map of maps) {
    const files = new Map<MapFileSuffix, Uint8Array>();
    await Promise.all(
      MAP_FILE_SUFFIXES.map(async (suffix) => {
        const url = catalogSidecarUrl(options.api, irVersion, map.mapId, suffix);
        let response: Response;
        try {
          response = await fetchImpl(url, options.signal === undefined ? {} : { signal: options.signal });
        } catch (error) {
          throw new CatalogInstallError('download', `${url}: ${String(error)}`);
        }
        if (response.status === HTTP_NOT_FOUND && suffix !== TERRAIN) {
          await response.body?.cancel();
        } else {
          if (!response.ok) throw new CatalogInstallError('download', `${url}: HTTP ${response.status}`);
          const bytes = await readCapped(
            response,
            suffix === PICTURE ? MAX_MAP_PICTURE_BYTES : MAX_MAP_DOCUMENT_BYTES,
            url,
          );
          checkSidecar(suffix, bytes, url);
          files.set(suffix, bytes);
        }
        done++;
        options.onProgress?.({ done, total });
      }),
    );
    const terrain = files.get(TERRAIN);
    if (terrain === undefined) throw new CatalogInstallError('download', `${map.mapId} has no terrain`);
    const script = files.get(SCRIPT);
    let fingerprint: string;
    try {
      fingerprint = verifyMapDocuments(
        map.mapId,
        json(terrain, map.mapId),
        script === undefined ? null : json(script, map.mapId),
      ).fingerprint;
    } catch (error) {
      throw new CatalogInstallError('verify', `${map.mapId}: ${String(error)}`);
    }
    if (fingerprint !== map.fingerprint)
      throw new CatalogInstallError('verify', `${map.mapId} does not match the catalogue's fingerprint`);
    const suffixes = MAP_FILE_SUFFIXES.filter((suffix) => files.has(suffix));
    installable.push({
      record: {
        version: INSTALLED_MAP_RECORD_VERSION,
        revision: crypto.randomUUID(),
        mapId: map.mapId,
        entryId: entry.id,
        fingerprint,
        irVersion,
        index: installedIndex(entry, map.mapId, map.index),
        installedAt,
        size: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
        suffixes,
      },
      files,
    });
  }
  await options.store.install(entry.id, installable);
  return installable.map((map) => map.record);
}

export interface AnnouncedMapServices {
  readonly api?: string;
  readonly store?: InstalledMapStore | null;
  readonly fetchImpl?: typeof fetch;
  readonly irVersion?: number;
}

/**
 * A room's catalogue map fetched from the catalogue server, or null when this build or the server cannot
 * supply the exact conversion the creator announced; the caller then asks the creator through the relay.
 */
export async function installAnnouncedCatalogMap(
  announced: CatalogMapAnnouncement,
  services: AnnouncedMapServices = {},
): Promise<VerifiedMapDocuments | null> {
  const irVersion = services.irVersion ?? IR_VERSION;
  const store = services.store === undefined ? installedMapStore() : services.store;
  if (store === null || announced.irVersion !== irVersion) return null;
  const api = services.api ?? apiBaseUrl();
  const fetchImpl = services.fetchImpl ?? fetch;
  const entry = await fetchCatalogEntry(api, announced.entryId, fetchImpl);
  const listed =
    entry === null ? undefined : convertedMaps(entry).find((map) => map.mapId === announced.mapId);
  if (entry === null || listed?.fingerprint !== announced.fingerprint) return null;
  const records = await installCatalogEntry(entry, { api, store, fetchImpl, irVersion });
  const record = records.find((item) => item.mapId === announced.mapId);
  if (record === undefined) return null;
  const documents = await loadVerifiedMapDocuments(announced.mapId, store.fetchFor(record));
  return documents?.fingerprint === announced.fingerprint ? documents : null;
}
