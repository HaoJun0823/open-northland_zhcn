import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  INSTALLED_MAP_GENERATION,
  MAX_INSTALLED_MAP_RECORD_BYTES,
  parseInstalledMapFileWrite,
  parseInstalledMapId,
  parseInstalledMapSuffix,
} from './installed.js';

import {
  parseSourceRecord,
  parseSourceWrite,
  parseStoredSource,
  readSource,
  type StoredSource,
  writeSource,
} from './local-source.js';

const MANIFEST_VERSION = 2;
const MANIFEST = 'installed.json';
const GENERATIONS = 'files';
/** Bounds one IPC request, not the total installed collection. */
const MAX_COMMIT_BYTES = 512 * 1024 * 1024;
const MAX_COMMIT_MAPS = 5000;

interface StoredMap {
  readonly mapId: string;
  readonly folder: string;
  readonly record: Record<string, unknown>;
  readonly suffixes: readonly string[];
}
interface MapWrite {
  readonly mapId: string;
  readonly record: Record<string, unknown>;
  readonly files: readonly (readonly [string, Uint8Array])[];
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid map metadata');
  return value as Record<string, unknown>;
}
function metadata(value: unknown): Record<string, unknown> {
  const record = object(value);
  parseInstalledMapId(record.mapId);
  if (typeof record.revision !== 'string' || !INSTALLED_MAP_GENERATION.test(record.revision))
    throw new Error('Invalid map revision');
  // The app owns the record schema; the shell owns containment and bounded persistence.
  const json = JSON.stringify(record);
  if (Buffer.byteLength(json) > MAX_INSTALLED_MAP_RECORD_BYTES)
    throw new Error('Map metadata exceeds the size limit');
  return JSON.parse(json) as Record<string, unknown>;
}
function writes(raw: unknown, sourceBytes = 0): MapWrite[] {
  if (!Array.isArray(raw) || raw.length > MAX_COMMIT_MAPS) throw new Error('Invalid map batch');
  let total = sourceBytes;
  const ids = new Set<string>();
  return raw.map((item: unknown) => {
    const value = object(item);
    const record = metadata(value.record);
    total += Buffer.byteLength(JSON.stringify(record));
    if (total > MAX_COMMIT_BYTES) throw new Error('Map batch exceeds the size limit');
    const mapId = parseInstalledMapId(record.mapId);
    if (ids.has(mapId)) throw new Error('Duplicate map id');
    ids.add(mapId);
    if (!Array.isArray(value.files) || value.files.length === 0) throw new Error('Invalid map files');
    const seen = new Set<string>();
    const files = value.files.map((pair: unknown): readonly [string, Uint8Array] => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid map file');
      const parsed = parseInstalledMapFileWrite(mapId, pair[0], pair[1]);
      if (seen.has(parsed.suffix)) throw new Error('Duplicate map file');
      seen.add(parsed.suffix);
      total += parsed.bytes.byteLength;
      if (total > MAX_COMMIT_BYTES) throw new Error('Map batch exceeds the size limit');
      return [parsed.suffix, parsed.bytes.slice()];
    });
    if (!seen.has('.json')) throw new Error('Map terrain is missing');
    return { mapId, record, files };
  });
}

interface Manifest {
  readonly maps: StoredMap[];
  readonly sources: StoredSource[];
}

async function manifest(root: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(join(root, MANIFEST), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { maps: [], sources: [] };
    throw error;
  }
  const data = object(JSON.parse(text));
  // Version 1 held only reproducible catalogue conversions, never a player's retained originals.
  if (data.version === 1) return { maps: [], sources: [] };
  if (data.version !== MANIFEST_VERSION || !Array.isArray(data.maps) || !Array.isArray(data.sources))
    throw new Error('Invalid installed-map manifest');
  const maps = data.maps.map((raw: unknown) => {
    const map = object(raw);
    const mapId = parseInstalledMapId(map.mapId);
    const record = metadata(map.record);
    if (
      record.mapId !== mapId ||
      typeof map.folder !== 'string' ||
      !INSTALLED_MAP_GENERATION.test(map.folder) ||
      !Array.isArray(map.suffixes)
    )
      throw new Error('Invalid installed-map entry');
    const suffixes = map.suffixes.map(parseInstalledMapSuffix);
    if (!suffixes.includes('.json') || new Set(suffixes).size !== suffixes.length)
      throw new Error('Invalid installed-map files');
    return { mapId, record, folder: map.folder, suffixes };
  });
  return { maps, sources: data.sources.map(parseStoredSource) };
}

/** Files are immutable per generation; publishing one manifest commits both metadata and the pack.
 * Reads and writes share a queue so cleanup cannot remove a generation while a snapshot reads it. */
export function createDesktopMapStore(root: string) {
  let pending: Promise<unknown> = Promise.resolve();
  // One shell owns this profile. Listing thumbnails must not reparse the whole manifest per image.
  let current: Manifest | undefined;
  const liveMaps = async (): Promise<Manifest> => (current ??= await manifest(root));
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pending.then(run);
    pending = result.catch(() => undefined);
    return result;
  };
  const clean = async (live: Manifest): Promise<void> => {
    const keep = new Set([...live.maps, ...live.sources].map((map) => map.folder));
    const folders = await readdir(join(root, GENERATIONS)).catch(() => []);
    await Promise.all(
      folders
        .filter((folder) => INSTALLED_MAP_GENERATION.test(folder) && !keep.has(folder))
        .map((folder) => rm(join(root, GENERATIONS, folder), { recursive: true, force: true })),
    );
  };
  return {
    list: () =>
      serial(async () => {
        const live = await liveMaps();
        return [...live.maps, ...live.sources].map((item) => item.record);
      }),
    readSource: (rawId: unknown) => {
      const entryId = parseInstalledMapId(rawId);
      return serial(async () => {
        const source = (await liveMaps()).sources.find((item) => item.record.entryId === entryId);
        if (source === undefined) return null;
        const path = join(root, GENERATIONS, source.folder);
        if ((await lstat(path)).isSymbolicLink()) throw new Error('Symbolic source directory');
        return readSource(path, source);
      });
    },
    readFile: (rawId: unknown, rawSuffix: unknown) => {
      const mapId = parseInstalledMapId(rawId);
      const suffix = parseInstalledMapSuffix(rawSuffix);
      return serial(async () => {
        const map = (await liveMaps()).maps.find((item) => item.mapId === mapId);
        return map === undefined || !map.suffixes.includes(suffix)
          ? null
          : new Uint8Array(await readFile(join(root, GENERATIONS, map.folder, `${mapId}${suffix}`)));
      });
    },
    readMap: (rawId: unknown) => {
      const mapId = parseInstalledMapId(rawId);
      return serial(async () => {
        const map = (await liveMaps()).maps.find((item) => item.mapId === mapId);
        if (map === undefined) return { record: null, files: [] };
        const files = await Promise.all(
          map.suffixes.map(
            async (suffix): Promise<readonly [string, Uint8Array]> => [
              suffix,
              new Uint8Array(await readFile(join(root, GENERATIONS, map.folder, `${mapId}${suffix}`))),
            ],
          ),
        );
        return { record: map.record, files };
      });
    },
    commit: (rawDrop: unknown, rawPut: unknown, rawSources: unknown = { drop: [] }) => {
      const changes = object(rawSources);
      if (!Array.isArray(changes.drop) || changes.drop.length > MAX_COMMIT_MAPS)
        throw new Error('Invalid source removals');
      const sourceDrop = new Set(changes.drop.map(parseInstalledMapId));
      const sourcePut = changes.put === undefined ? undefined : parseSourceWrite(changes.put);
      const expected = changes.expected === undefined ? undefined : parseSourceRecord(changes.expected);
      if (!Array.isArray(rawDrop) || rawDrop.length > MAX_COMMIT_MAPS)
        throw new Error('Invalid map removals');
      const drop = new Set(rawDrop.map(parseInstalledMapId));
      const put = writes(
        rawPut,
        sourcePut === undefined
          ? 0
          : sourcePut.record.size + Buffer.byteLength(JSON.stringify(sourcePut.record)),
      );
      return serial(async () => {
        const previous = await liveMaps();
        if (
          expected !== undefined &&
          JSON.stringify(
            previous.sources.find((item) => item.record.entryId === expected.entryId)?.record,
          ) !== JSON.stringify(expected)
        )
          throw new Error('Local source changed during conversion');
        const nextSources = previous.sources.filter(
          (item) => !sourceDrop.has(item.record.entryId) && item.record.entryId !== sourcePut?.record.entryId,
        );
        const next = previous.maps.filter(
          (map) => !drop.has(map.mapId) && !put.some((item) => item.mapId === map.mapId),
        );
        for (const path of [root, join(root, GENERATIONS)]) {
          const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          });
          if (info?.isSymbolicLink()) throw new Error('Symbolic storage directory');
          await mkdir(path, { recursive: true });
        }
        const staged: string[] = [];
        const partial = join(root, `${MANIFEST}.partial`);
        try {
          for (const map of put) {
            const folder = randomUUID();
            const path = join(root, GENERATIONS, folder);
            staged.push(path);
            await mkdir(path);
            for (const [suffix, bytes] of map.files)
              await writeFile(join(path, `${map.mapId}${suffix}`), bytes, { flag: 'wx' });
            next.push({
              mapId: map.mapId,
              folder,
              record: map.record,
              suffixes: map.files.map(([suffix]) => suffix),
            });
          }
          if (sourcePut !== undefined) {
            const folder = randomUUID();
            const path = join(root, GENERATIONS, folder);
            staged.push(path);
            await mkdir(path);
            nextSources.push(await writeSource(path, sourcePut, folder));
          }
          await writeFile(
            partial,
            JSON.stringify({ version: MANIFEST_VERSION, maps: next, sources: nextSources }),
            { flag: 'wx' },
          );
          await rename(partial, join(root, MANIFEST));
          current = { maps: next, sources: nextSources };
        } catch (error) {
          await Promise.allSettled([
            ...staged.map((path) => rm(path, { recursive: true, force: true })),
            rm(partial, { force: true }),
          ]);
          throw error;
        }
        // Publication already succeeded; failed cleanup must not report a failed installation.
        await clean({ maps: next, sources: nextSources }).catch(() => undefined);
      });
    },
  };
}
