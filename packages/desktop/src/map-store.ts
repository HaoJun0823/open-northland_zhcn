import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseInstalledMapFileWrite,
  parseInstalledMapId,
  parseInstalledMapSuffix,
} from './installed-maps.js';

const MANIFEST_VERSION = 1;
const MANIFEST = 'installed.json';
const GENERATIONS = 'files';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/** Bounds one IPC request, not the total installed collection. */
const MAX_COMMIT_BYTES = 512 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
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
  if (typeof record.revision !== 'string' || !UUID.test(record.revision))
    throw new Error('Invalid map revision');
  // The app owns the record schema; the shell owns containment and bounded persistence.
  const json = JSON.stringify(record);
  if (Buffer.byteLength(json) > MAX_RECORD_BYTES) throw new Error('Map metadata exceeds the size limit');
  return JSON.parse(json) as Record<string, unknown>;
}
function writes(raw: unknown): MapWrite[] {
  if (!Array.isArray(raw) || raw.length > MAX_COMMIT_MAPS) throw new Error('Invalid map batch');
  let total = 0;
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

async function manifest(root: string): Promise<StoredMap[]> {
  let text: string;
  try {
    text = await readFile(join(root, MANIFEST), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const data = object(JSON.parse(text));
  if (data.version !== MANIFEST_VERSION || !Array.isArray(data.maps))
    throw new Error('Invalid installed-map manifest');
  return data.maps.map((raw: unknown) => {
    const map = object(raw);
    const mapId = parseInstalledMapId(map.mapId);
    const record = metadata(map.record);
    if (
      record.mapId !== mapId ||
      typeof map.folder !== 'string' ||
      !UUID.test(map.folder) ||
      !Array.isArray(map.suffixes)
    )
      throw new Error('Invalid installed-map entry');
    const suffixes = map.suffixes.map(parseInstalledMapSuffix);
    if (!suffixes.includes('.json') || new Set(suffixes).size !== suffixes.length)
      throw new Error('Invalid installed-map files');
    return { mapId, record, folder: map.folder, suffixes };
  });
}

/** Files are immutable per generation; publishing one manifest commits both metadata and the pack.
 * Reads and writes share a queue so cleanup cannot remove a generation while a snapshot reads it. */
export function createDesktopMapStore(root: string) {
  let pending: Promise<unknown> = Promise.resolve();
  // One shell owns this profile. Listing thumbnails must not reparse the whole manifest per image.
  let current: StoredMap[] | undefined;
  const liveMaps = async (): Promise<StoredMap[]> => (current ??= await manifest(root));
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pending.then(run);
    pending = result.catch(() => undefined);
    return result;
  };
  const clean = async (live: readonly StoredMap[]): Promise<void> => {
    const keep = new Set(live.map((map) => map.folder));
    const folders = await readdir(join(root, GENERATIONS)).catch(() => []);
    await Promise.all(
      folders
        .filter((folder) => UUID.test(folder) && !keep.has(folder))
        .map((folder) => rm(join(root, GENERATIONS, folder), { recursive: true, force: true })),
    );
  };
  return {
    list: () => serial(async () => (await liveMaps()).map((map) => map.record)),
    readFile: (rawId: unknown, rawSuffix: unknown) => {
      const mapId = parseInstalledMapId(rawId);
      const suffix = parseInstalledMapSuffix(rawSuffix);
      return serial(async () => {
        const map = (await liveMaps()).find((item) => item.mapId === mapId);
        return map === undefined || !map.suffixes.includes(suffix)
          ? null
          : new Uint8Array(await readFile(join(root, GENERATIONS, map.folder, `${mapId}${suffix}`)));
      });
    },
    readMap: (rawId: unknown) => {
      const mapId = parseInstalledMapId(rawId);
      return serial(async () => {
        const map = (await liveMaps()).find((item) => item.mapId === mapId);
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
    commit: (rawDrop: unknown, rawPut: unknown) => {
      if (!Array.isArray(rawDrop) || rawDrop.length > MAX_COMMIT_MAPS)
        throw new Error('Invalid map removals');
      const drop = new Set(rawDrop.map(parseInstalledMapId));
      const put = writes(rawPut);
      return serial(async () => {
        const previous = await liveMaps();
        const next = previous.filter(
          (map) => !drop.has(map.mapId) && !put.some((item) => item.mapId === map.mapId),
        );
        await mkdir(join(root, GENERATIONS), { recursive: true });
        const staged: string[] = [];
        const partial = join(root, `${MANIFEST}.partial`);
        try {
          for (const map of put) {
            const folder = randomUUID();
            const path = join(root, GENERATIONS, folder);
            staged.push(path);
            await mkdir(path);
            for (const [suffix, bytes] of map.files)
              await writeFile(join(path, `${map.mapId}${suffix}`), bytes);
            next.push({
              mapId: map.mapId,
              folder,
              record: map.record,
              suffixes: map.files.map(([suffix]) => suffix),
            });
          }
          await writeFile(partial, JSON.stringify({ version: MANIFEST_VERSION, maps: next }));
          await rename(partial, join(root, MANIFEST));
          current = next;
        } catch (error) {
          await Promise.allSettled([
            ...staged.map((path) => rm(path, { recursive: true, force: true })),
            rm(partial, { force: true }),
          ]);
          throw error;
        }
        // Publication already succeeded; failed cleanup must not report a failed installation.
        await clean(next).catch(() => undefined);
      });
    },
  };
}
