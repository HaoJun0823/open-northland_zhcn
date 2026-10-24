import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { DEFAULT_IMPORT_LIMITS, isMapTreePath, MapImportError } from '@open-northland/map-import/input';

export type LocalMapBytes =
  | { readonly kind: 'archive'; readonly name: string; readonly bytes: Uint8Array }
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
    };
export type LocalMapPick =
  | { readonly kind: 'picked'; readonly input: LocalMapBytes }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'failed';
      readonly failure: 'too-large' | 'unsupported-archive' | 'read-failed';
      readonly message: string;
    };

export function localPath(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.includes('\0'))
    throw new Error('Invalid source path');
  const path = value.replace(/\\/g, '/');
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes(':')))
    throw new Error('Invalid source path');
  if (parts.length > DEFAULT_IMPORT_LIMITS.depth)
    throw new MapImportError('too-large', 'Source path too deep');
  return path;
}

export function parseLocalMapBytes(raw: unknown): LocalMapBytes {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid source');
  const value = raw as Record<string, unknown>;
  const name = localPath(value.name);
  if (name.includes('/')) throw new Error('Invalid source name');
  if (value.kind === 'archive') {
    if (!(value.bytes instanceof Uint8Array)) throw new Error('Invalid archive bytes');
    if (value.bytes.length > DEFAULT_IMPORT_LIMITS.archiveBytes)
      throw new MapImportError('too-large', 'Archive exceeds limit');
    return { kind: 'archive', name, bytes: value.bytes.slice() };
  }
  if (value.kind !== 'folder' || !Array.isArray(value.files)) throw new Error('Invalid source folder');
  if (value.files.length > DEFAULT_IMPORT_LIMITS.entries)
    throw new MapImportError('too-large', 'Too many source files');
  let total = 0;
  const paths = new Set<string>();
  const files = value.files.map((rawFile: unknown) => {
    if (typeof rawFile !== 'object' || rawFile === null) throw new Error('Invalid source file');
    const item = rawFile as Record<string, unknown>;
    const path = localPath(item.path);
    if (!isMapTreePath(path) || paths.has(path.toLowerCase()) || !(item.bytes instanceof Uint8Array))
      throw new Error('Invalid source file');
    paths.add(path.toLowerCase());
    total += item.bytes.length;
    if (item.bytes.length > DEFAULT_IMPORT_LIMITS.entryBytes || total > DEFAULT_IMPORT_LIMITS.unpackedBytes)
      throw new MapImportError('too-large', 'Folder exceeds limit');
    return { path, bytes: item.bytes.slice() };
  });
  return { kind: 'folder', name, files };
}

/** O_NOFOLLOW rejects a file swapped for a symlink after enumeration. The size is checked before allocation. */
export async function readBoundedFile(
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink()) throw new Error('Expected a regular file');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Expected a regular file');
    if (info.size > limit) throw new MapImportError('too-large', 'File exceeds limit');
    const bytes = new Uint8Array(info.size);
    let at = 0;
    while (at < bytes.length) {
      signal?.throwIfAborted();
      const read = await handle.read(bytes, at, Math.min(64 * 1024, bytes.length - at), at);
      if (read.bytesRead === 0) throw new Error('Source changed during read');
      at += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw new Error('Source changed during read');
    return bytes;
  } finally {
    await handle.close();
  }
}

/** The only filesystem paths accepted here come from the native dialog, never renderer arguments. */
export async function readPickedMap(
  path: string,
  kind: 'archive' | 'folder',
  signal: AbortSignal,
): Promise<LocalMapBytes> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported');
  const name = basename(path);
  if (kind === 'archive')
    return { kind, name, bytes: await readBoundedFile(path, DEFAULT_IMPORT_LIMITS.archiveBytes, signal) };
  if (!stat.isDirectory()) throw new Error('Expected a folder');
  const root = await realpath(path);
  const candidates: { path: string; size: number }[] = [];
  let count = 0;
  let total = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    signal.throwIfAborted();
    if (depth > DEFAULT_IMPORT_LIMITS.depth) throw new MapImportError('too-large', 'Folder too deep');
    const entries = await opendir(directory);
    for await (const entry of entries) {
      signal.throwIfAborted();
      if (++count > DEFAULT_IMPORT_LIMITS.entries)
        throw new MapImportError('too-large', 'Too many folder entries');
      const full = join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not supported');
      if (info.isDirectory()) await walk(full, depth + 1);
      else if (info.isFile()) {
        const rel = localPath(relative(root, full));
        if (!isMapTreePath(rel)) continue;
        total += info.size;
        if (info.size > DEFAULT_IMPORT_LIMITS.entryBytes || total > DEFAULT_IMPORT_LIMITS.unpackedBytes)
          throw new MapImportError('too-large', 'Folder exceeds limit');
        candidates.push({ path: rel, size: info.size });
      } else throw new Error('Special files are not supported');
    }
  }
  await walk(root, 0);
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const candidate of candidates) {
    const full = join(root, candidate.path);
    const canonical = await realpath(full);
    if (canonical !== full) throw new Error('Source path changed');
    files.push({ path: candidate.path, bytes: await readBoundedFile(full, candidate.size, signal) });
  }
  return { kind, name, files };
}

export function createLocalMapPicker(show: (kind: 'archive' | 'folder') => Promise<string | undefined>) {
  let active: AbortController | null = null;
  async function run(rawKind: unknown, droppedPath?: string): Promise<LocalMapPick> {
    if (rawKind !== 'archive' && rawKind !== 'folder') throw new Error('Invalid picker kind');
    if (active !== null) throw new Error('Picker already active');
    const controller = new AbortController();
    active = controller;
    try {
      const path = droppedPath ?? (await show(rawKind));
      if (path === undefined || controller.signal.aborted) return { kind: 'cancelled' };
      const kind =
        droppedPath === undefined ? rawKind : (await lstat(path)).isDirectory() ? 'folder' : 'archive';
      return {
        kind: 'picked',
        input: parseLocalMapBytes(await readPickedMap(path, kind, controller.signal)),
      };
    } catch (error) {
      if (controller.signal.aborted) return { kind: 'cancelled' };
      return {
        kind: 'failed',
        failure:
          error instanceof MapImportError
            ? error.kind === 'too-large'
              ? 'too-large'
              : 'unsupported-archive'
            : 'read-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      active = null;
    }
  }
  return {
    cancel: () => active?.abort(),
    pick: (kind: unknown) => run(kind),
    drop: (path: unknown) => {
      if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
        throw new Error('Invalid dropped file');
      return run('archive', path);
    },
  };
}
