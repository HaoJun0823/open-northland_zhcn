import { MapImportError } from '../errors.js';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from '../limits.js';
import { type MapTree, TreeBuilder } from '../tree.js';
import { unpackC2m } from './c2m.js';
import {
  type ArchiveFormat,
  assertArchiveSize,
  detectArchiveFormat,
  fillTree,
  type Unpack,
} from './entries.js';

export { detectArchiveFormat };

import { unpackRar } from './rar.js';
import { unpackZip } from './zip.js';

export interface OpenOptions {
  readonly limits?: ImportLimits;
  /** The `node-unrar-js` wasm binary; without it a RAR, top-level or nested, is `unsupported-archive`. */
  readonly unrarWasm?: ArrayBuffer;
  /** Names the archive in failure messages. */
  readonly name?: string;
}

function unpackers(options: OpenOptions): (format: ArchiveFormat) => Unpack {
  return (format) => {
    switch (format) {
      case 'zip':
        return unpackZip;
      case 'c2m':
        return unpackC2m;
      case 'rar': {
        const wasm = options.unrarWasm;
        if (wasm === undefined) {
          return () => Promise.reject(new MapImportError('unsupported-archive', 'rar: no unrar wasm given'));
        }
        return (bytes, builder, keep) => unpackRar(bytes, builder, keep, wasm);
      }
    }
  };
}

async function open(bytes: Uint8Array, format: ArchiveFormat, options: OpenOptions): Promise<MapTree> {
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  const source = options.name ?? format;
  assertArchiveSize(bytes, limits, source);
  const builder = new TreeBuilder(limits, source);
  await fillTree(bytes, format, builder, unpackers(options));
  return builder.build();
}

/** The map files of a zip, nested `.c2m`/`.rar`/`.zip` entries opened one level deep. */
export function openZip(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'zip', options);
}

/** The map files of a RAR4 or RAR5 archive; `wasm` is the `node-unrar-js` binary. */
export function openRar(bytes: Uint8Array, wasm: ArrayBuffer, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'rar', { ...options, unrarWasm: wasm });
}

/** The map files of a map editor `.c2m` export, rooted where its map folder was. */
export function openC2m(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'c2m', options);
}

/** Opens whichever supported archive `bytes` hold, told apart by their leading bytes. */
export function openArchive(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  const format = detectArchiveFormat(bytes);
  if (format === undefined) {
    return Promise.reject(
      new MapImportError('unsupported-archive', `${options.name ?? 'archive'}: not a zip, rar or c2m`),
    );
  }
  return open(bytes, format, options);
}
