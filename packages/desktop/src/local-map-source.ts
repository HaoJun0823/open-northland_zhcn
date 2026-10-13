import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_IMPORT_LIMITS } from '@open-northland/map-import/input';
import {
  INSTALLED_MAP_GENERATION,
  MAX_INSTALLED_MAP_RECORD_BYTES,
  parseInstalledMapId,
} from './installed-maps.js';
import { type LocalMapBytes, localPath, parseLocalMapBytes, readBoundedFile } from './local-map-input.js';

const LOCAL_SOURCE_RECORD_VERSION = 1;

export interface SourceRecord extends Record<string, unknown> {
  readonly entryId: string;
  readonly name: string;
  readonly size: number;
}
export interface SourceWrite {
  readonly record: SourceRecord;
  readonly input: LocalMapBytes;
}
export interface StoredSource {
  readonly record: SourceRecord;
  readonly folder: string;
  readonly kind: 'archive' | 'folder';
  readonly paths: readonly string[];
}

export function parseSourceRecord(raw: unknown): SourceRecord {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid source record');
  const r = raw as Record<string, unknown>;
  const id = parseInstalledMapId(r.entryId);
  if (
    r.kind !== 'local-source' ||
    r.version !== LOCAL_SOURCE_RECORD_VERSION ||
    !id.startsWith('user-') ||
    typeof r.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(r.fingerprint) ||
    typeof r.size !== 'number' ||
    !Number.isSafeInteger(r.size) ||
    r.size < 0 ||
    r.size > DEFAULT_IMPORT_LIMITS.unpackedBytes ||
    !Array.isArray(r.maps) ||
    r.maps.length === 0 ||
    r.maps.length > DEFAULT_IMPORT_LIMITS.entries
  )
    throw new Error('Invalid source record');
  const name = localPath(r.name);
  if (name.includes('/')) throw new Error('Invalid source name');
  const ids = new Set<string>();
  for (const rawMap of r.maps) {
    if (typeof rawMap !== 'object' || rawMap === null) throw new Error('Invalid source map');
    const map = rawMap as Record<string, unknown>;
    const mapId = parseInstalledMapId(map.mapId);
    if (!mapId.startsWith(`${id}-`) || ids.has(mapId) || typeof map.folder !== 'string')
      throw new Error('Invalid source map');
    ids.add(mapId);
  }
  const json = JSON.stringify(r);
  if (Buffer.byteLength(json) > MAX_INSTALLED_MAP_RECORD_BYTES)
    throw new Error('Source metadata exceeds limit');
  return JSON.parse(json) as SourceRecord;
}

export function parseSourceWrite(raw: unknown): SourceWrite {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid source write');
  const value = raw as Record<string, unknown>;
  const record = parseSourceRecord(value.record);
  const input = parseLocalMapBytes(value.input);
  const size =
    input.kind === 'archive'
      ? input.bytes.length
      : input.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (record.name !== input.name || record.size !== size) throw new Error('Source record differs from input');
  return { record, input };
}

/** Original paths are metadata only: disk filenames are generated numeric slots. */
export async function writeSource(path: string, source: SourceWrite, folder: string): Promise<StoredSource> {
  const files =
    source.input.kind === 'archive' ? [{ path: '', bytes: source.input.bytes }] : source.input.files;
  for (const [i, file] of files.entries())
    await writeFile(join(path, `${i}.source`), file.bytes, { flag: 'wx' });
  return { record: source.record, folder, kind: source.input.kind, paths: files.map((file) => file.path) };
}

export async function readSource(path: string, source: StoredSource): Promise<SourceWrite> {
  if (source.kind === 'archive')
    return {
      record: source.record,
      input: {
        kind: 'archive',
        name: source.record.name,
        bytes: await readBoundedFile(join(path, '0.source'), DEFAULT_IMPORT_LIMITS.archiveBytes),
      },
    };
  const files: { path: string; bytes: Uint8Array }[] = [];
  let remaining = DEFAULT_IMPORT_LIMITS.unpackedBytes;
  for (const [i, name] of source.paths.entries()) {
    const bytes = await readBoundedFile(
      join(path, `${i}.source`),
      Math.min(remaining, DEFAULT_IMPORT_LIMITS.entryBytes),
    );
    remaining -= bytes.length;
    files.push({ path: name, bytes });
  }
  return { record: source.record, input: { kind: 'folder', name: source.record.name, files } };
}

export function parseStoredSource(raw: unknown): StoredSource {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid stored source');
  const item = raw as Record<string, unknown>;
  if (
    typeof item.folder !== 'string' ||
    !INSTALLED_MAP_GENERATION.test(item.folder) ||
    (item.kind !== 'archive' && item.kind !== 'folder') ||
    !Array.isArray(item.paths) ||
    item.paths.length > DEFAULT_IMPORT_LIMITS.entries
  )
    throw new Error('Invalid stored source');
  const record = parseSourceRecord(item.record);
  const paths =
    item.kind === 'archive'
      ? item.paths.length === 1 && item.paths[0] === ''
        ? ['']
        : null
      : item.paths.map(localPath);
  if (paths === null || new Set(paths.map((path) => path.toLowerCase())).size !== paths.length)
    throw new Error('Invalid stored source paths');
  return { record, folder: item.folder, kind: item.kind, paths };
}
