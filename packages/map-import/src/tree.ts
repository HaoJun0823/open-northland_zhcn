import { MapImportError } from './errors.js';
import { isMapFile } from './layout.js';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from './limits.js';

/** An unpacked import: the map files of an archive or folder, nothing else. */
export interface MapTree {
  /** File bytes keyed by lower-cased, `/`-separated path relative to the tree root. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Each key's path as the archive or folder spells it, for provenance and source labels. */
  readonly names: ReadonlyMap<string, string>;
}

/** Forward slashes, no leading `./` or `/`, no empty segment. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

/**
 * Collects one tree under the import's limits. An entry that escapes the root or folds onto a kept
 * path is `unsupported-archive`; crossing a limit is `too-large`.
 */
export class TreeBuilder {
  private readonly files = new Map<string, Uint8Array>();
  private readonly names = new Map<string, string>();
  private unpacked = 0;
  private listed = 0;

  constructor(
    readonly limits: ImportLimits,
    private readonly source: string,
  ) {}

  /** Counts one listed entry, kept or not. */
  list(count = 1): void {
    this.listed += count;
    if (this.listed > this.limits.entries) {
      throw new MapImportError('too-large', `${this.source}: more than ${this.limits.entries} entries`);
    }
  }

  /** Throws unless an entry of `size` bytes fits the per-entry and total budgets. */
  reserve(path: string, size: number): void {
    if (size > this.limits.entryBytes) {
      throw new MapImportError(
        'too-large',
        `${this.source}: ${path} unpacks to ${size} bytes, over ${this.limits.entryBytes}`,
      );
    }
    if (this.unpacked + size > this.limits.unpackedBytes) {
      throw new MapImportError(
        'too-large',
        `${this.source}: unpacks past ${this.limits.unpackedBytes} bytes at ${path}`,
      );
    }
  }

  add(path: string, bytes: Uint8Array): void {
    const spelled = normalizePath(path);
    // `..` climbs out of the root and a `:` names a drive or stream; neither belongs in a map folder.
    if (spelled.split('/').some((part) => part === '..' || part.includes(':'))) {
      throw new MapImportError('unsupported-archive', `${this.source}: ${path} leaves the archive root`);
    }
    if (spelled.split('/').length > this.limits.depth) {
      throw new MapImportError('too-large', `${this.source}: ${path} is deeper than ${this.limits.depth}`);
    }
    this.reserve(spelled, bytes.length);
    const key = spelled.toLowerCase();
    const twin = this.names.get(key);
    if (twin !== undefined) {
      throw new MapImportError(
        'unsupported-archive',
        `${this.source}: "${twin}" and "${spelled}" name one file`,
      );
    }
    this.unpacked += bytes.length;
    this.files.set(key, bytes);
    this.names.set(key, spelled);
  }

  build(): MapTree {
    return { files: this.files, names: this.names };
  }
}

/** Whether an entry path is one the conversion reads; everything else in an import is ignored. */
export function isMapTreePath(path: string): boolean {
  return isMapFile(normalizePath(path).toLowerCase());
}

/**
 * A tree from an already listed folder: reads only the map files among `paths`, through `read`, in
 * the given order. `paths` are relative to the folder, either separator.
 */
export async function treeFromFolder(
  paths: Iterable<string>,
  read: (path: string) => Promise<Uint8Array>,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): Promise<MapTree> {
  const builder = new TreeBuilder(limits, 'folder');
  for (const path of paths) {
    builder.list();
    if (!isMapTreePath(path)) continue;
    builder.add(path, await read(path));
  }
  return builder.build();
}
