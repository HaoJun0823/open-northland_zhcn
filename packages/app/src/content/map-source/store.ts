import { desktopMaps } from '../../view/platform/desktop-bridge.js';
import { localInputBytes } from '../local-import/input.js';
import {
  type LocalSourceRecord,
  localSourceRecord,
  type RetainedLocalSource,
} from '../local-import/source.js';
import { isMapId } from '../transfer/documents.js';
import type { ContentFetch } from '../url.js';
import { type MapFileSuffix, mapFileContentType, storedMapFetch } from './files.js';
import {
  type InstallableMap,
  type InstalledMapRecord,
  installedRecord,
  MAX_INSTALLED_MAP_BYTES,
  retainedEntries,
} from './installed.js';
import { browserInstalledMapStorage, desktopInstalledMapStorage } from './storage.js';

export { browserInstalledMapStorage, desktopInstalledMapStorage } from './storage.js';

export interface SourceChanges {
  readonly expected?: LocalSourceRecord;
  readonly drop: readonly string[];
  readonly put?: RetainedLocalSource;
}

/** The raw storage under an installed-map store: records, and the files where the store keeps them. */
export interface InstalledMapStorage {
  records(): Promise<readonly unknown[]>;
  readSource(entryId: string): Promise<RetainedLocalSource | null>;
  /** A record and its files from one storage revision. */
  readMap(
    mapId: string,
  ): Promise<{ readonly record: unknown; readonly files: ReadonlyMap<MapFileSuffix, Uint8Array> }>;
  readFile(mapId: string, suffix: MapFileSuffix): Promise<Uint8Array | null>;
  /** Drops the named maps' records and files, then stores the new maps, as one step where it can. */
  commit(drop: readonly string[], put: readonly InstallableMap[], sources: SourceChanges): Promise<void>;
}

export interface InstalledMapStore {
  list(): Promise<readonly InstalledMapRecord[]>;
  sources(): Promise<readonly LocalSourceRecord[]>;
  readSource(entryId: string): Promise<RetainedLocalSource | null>;
  /** Replaces one complete map pack and, for a local import, its retained input. */
  install(
    entryId: string,
    maps: readonly InstallableMap[],
    source?: RetainedLocalSource,
    expectedSource?: LocalSourceRecord,
  ): Promise<void>;
  remove(entryId: string): Promise<void>;
  /** A fetch that serves the map's `/maps/` paths. */
  fetchFor(record: InstalledMapRecord): ContentFetch;
  /** Where the map's authored picture shows from, or null when it has none. */
  pictureUrl(record: InstalledMapRecord): Promise<string | null>;
}

export interface InstalledMapStoreOptions {
  /** Bytes the store may hold before evicting whole entries; null keeps everything. */
  readonly budget: number | null;
}

const PICTURE: MapFileSuffix = '.png';

function rawMapId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const mapId = (raw as Record<string, unknown>).mapId;
  return typeof mapId === 'string' && isMapId(mapId) ? mapId : null;
}

export class LocalSourceChangedError extends Error {
  constructor() {
    super('Local source changed during conversion');
    this.name = 'LocalSourceChangedError';
  }
}

const STORE_LOCK = 'open-northland-installed-maps';
let pending: Promise<void> = Promise.resolve();
function mutate(run: () => Promise<void>): Promise<void> {
  const result = pending.then(() =>
    typeof navigator !== 'undefined' && navigator.locks !== undefined
      ? navigator.locks.request(STORE_LOCK, run)
      : run(),
  );
  pending = result.catch(() => undefined);
  return result;
}

export function createInstalledMapStore(
  storage: InstalledMapStorage,
  options: InstalledMapStoreOptions,
): InstalledMapStore {
  // One object URL per stored picture, so a list redrawn after an install does not leak them.
  const pictures = new Map<string, Promise<string | null>>();
  const read = async () => {
    const raw = await storage.records();
    const valid: InstalledMapRecord[] = [];
    const broken: string[] = [];
    const sources: LocalSourceRecord[] = [];
    for (const item of raw) {
      const source = localSourceRecord(item);
      if (source !== null) {
        sources.push(source);
        continue;
      }
      const record = installedRecord(item);
      if (record !== null) valid.push(record);
      else {
        const mapId = rawMapId(item);
        if (mapId !== null) broken.push(mapId);
      }
    }
    return { valid, broken, sources };
  };
  const forgetPictures = (mapIds: readonly string[]): void => {
    for (const [key, picture] of pictures)
      if (mapIds.some((mapId) => key.startsWith(`${mapId}:`))) {
        pictures.delete(key);
        void picture.then((url) => {
          if (url !== null) URL.revokeObjectURL(url);
        });
      }
  };
  return {
    async list() {
      return (await read()).valid;
    },
    async sources() {
      return (await read()).sources;
    },
    async readSource(entryId) {
      return storage.readSource(entryId);
    },
    install(entryId, maps, source, expectedSource) {
      return mutate(async () => {
        if (
          maps.length === 0 ||
          new Set(maps.map((map) => map.record.mapId)).size !== maps.length ||
          maps.some((map) => map.record.entryId !== entryId || installedRecord(map.record) === null)
        )
          throw new Error('Install must contain valid maps from one entry');
        const user = maps.some((map) => map.record.index.provenance?.kind === 'user');
        if (
          user !== (source !== undefined) ||
          maps.some((map) => (map.record.index.provenance?.kind === 'user') !== user)
        )
          throw new Error('Local maps require their source');
        if (
          source !== undefined &&
          (localSourceRecord(source.record) === null ||
            source.record.entryId !== entryId ||
            source.record.name !== source.input.name ||
            source.record.size !== localInputBytes(source.input) ||
            source.record.maps.length !== maps.length ||
            source.record.maps.some((item) => !maps.some((map) => map.record.mapId === item.mapId)))
        )
          throw new Error('Source does not describe the installed map pack');
        const { valid, broken, sources } = await read();
        if (expectedSource !== undefined) {
          const current = sources.find((item) => item.entryId === entryId);
          if (
            current === undefined ||
            current.fingerprint !== expectedSource.fingerprint ||
            current.name !== expectedSource.name ||
            current.size !== expectedSource.size ||
            JSON.stringify(current.maps) !== JSON.stringify(expectedSource.maps)
          )
            throw new LocalSourceChangedError();
        }
        const keep =
          options.budget === null
            ? null
            : retainedEntries(
                valid,
                maps.map((map) => map.record),
                options.budget,
                sources,
                source?.record,
              );
        const dropEntries = new Set(
          valid
            .filter((record) => record.entryId === entryId || (keep !== null && !keep.has(record.entryId)))
            .map((record) => record.entryId),
        );
        dropEntries.add(entryId);
        const drop = new Set([
          ...broken,
          ...valid.filter((record) => dropEntries.has(record.entryId)).map((record) => record.mapId),
          ...sources
            .filter((item) => dropEntries.has(item.entryId))
            .flatMap((item) => item.maps.map((map) => map.mapId)),
        ]);
        await storage.commit([...drop], maps, {
          drop: sources.filter((item) => dropEntries.has(item.entryId)).map((item) => item.entryId),
          ...(source === undefined ? {} : { put: source }),
          ...(expectedSource === undefined ? {} : { expected: expectedSource }),
        });
        forgetPictures([...drop]);
      });
    },
    remove(entryId) {
      return mutate(async () => {
        const { valid, broken, sources } = await read();
        const source = sources.find((item) => item.entryId === entryId);
        const drop = [
          ...new Set([
            ...broken,
            ...valid.filter((record) => record.entryId === entryId).map((record) => record.mapId),
            ...(source?.maps.map((map) => map.mapId) ?? []),
          ]),
        ];
        await storage.commit(drop, [], { drop: source === undefined ? [] : [entryId] });
        forgetPictures(drop);
      });
    },
    fetchFor(record) {
      let snapshot: Promise<ReadonlyMap<MapFileSuffix, Uint8Array>> | undefined;
      return storedMapFetch(record.mapId, async (suffix) => {
        snapshot ??= storage.readMap(record.mapId).then((stored) => {
          const current = installedRecord(stored.record);
          if (current === null || current.revision !== record.revision)
            throw new Error('Installed map changed before loading');
          return stored.files;
        });
        const files = await snapshot;
        return record.suffixes.includes(suffix) ? (files.get(suffix) ?? null) : null;
      });
    },
    pictureUrl(record) {
      if (!record.suffixes.includes(PICTURE)) return Promise.resolve(null);
      const key = `${record.mapId}:${record.revision}`;
      let url = pictures.get(key);
      if (url === undefined) {
        url = storage
          .readFile(record.mapId, PICTURE)
          .then((bytes) =>
            bytes === null
              ? null
              : URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mapFileContentType(PICTURE) })),
          );
        pictures.set(key, url);
      }
      return url;
    },
  };
}

let platformStore: InstalledMapStore | null | undefined;

/** The installed-map store of the platform the page runs on, or null where IndexedDB is missing. */
export function installedMapStore(): InstalledMapStore | null {
  if (platformStore !== undefined) return platformStore;
  if (typeof indexedDB === 'undefined') {
    platformStore = null;
    return null;
  }
  const desktop = desktopMaps();
  platformStore =
    desktop === null
      ? createInstalledMapStore(browserInstalledMapStorage(), {
          budget: MAX_INSTALLED_MAP_BYTES,
        })
      : createInstalledMapStore(desktopInstalledMapStorage(desktop), { budget: null });
  return platformStore;
}
