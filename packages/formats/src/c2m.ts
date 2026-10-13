/**
 * `.c2m`, the map editor's single-file export of one user map, little-endian throughout:
 *
 *   u32  version     (observed 1)
 *   u32  dirCount    (observed 2 or 5)
 *   u32  fileCount
 *   dirCount  x { u32 nameLength, name, u32 index }       index = the record's position
 *   fileCount x { u32 nameLength, name, u32 offset, u32 size }
 *   the file blobs, contiguous after the directory, at their absolute offsets
 *
 * Names are backslash paths ending in `\` for a directory, rooted at `\` and `currentusermap\`
 * (`currentusermap\map.dat`, `currentusermap\text\pol\strings.cif`). Byte evidence: all 61 `.c2m`
 * files of the culturesnation catalogue parse this way, the last blob ending exactly at the file end.
 */

import { ByteCursor } from './byte-cursor.js';
import { DecodeLimitError } from './limit.js';

export const C2M_VERSION = 1;
const C2M_PREFIX = 'c2m';
const U32_BYTES = 4;
/** The smallest directory record: a length word plus the trailing index or offset word. */
const MIN_RECORD_BYTES = 2 * U32_BYTES;

export interface C2mFile {
  /** The stored path, backslashes as written. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** True when `bytes` open with a `.c2m` header. */
export function isC2m(bytes: Uint8Array): boolean {
  if (bytes.length < 3 * U32_BYTES) return false;
  const cursor = new ByteCursor(bytes, C2M_PREFIX);
  return cursor.u32() === C2M_VERSION;
}

/** Every file record with a zero-copy view of its blob. Throws a `c2m:` error on a corrupt directory. */
export function decodeC2m(bytes: Uint8Array, maxEntries = Number.POSITIVE_INFINITY): C2mFile[] {
  const cursor = new ByteCursor(bytes, C2M_PREFIX);
  const version = cursor.u32();
  if (version !== C2M_VERSION) throw new Error(`${C2M_PREFIX}: version ${version}, expected ${C2M_VERSION}`);
  const dirCount = cursor.u32();
  const fileCount = cursor.u32();
  if (dirCount + fileCount > maxEntries)
    throw new DecodeLimitError(`c2m: ${dirCount + fileCount} entries exceed ${maxEntries}`);
  if ((dirCount + fileCount) * MIN_RECORD_BYTES > bytes.length) {
    throw new Error(
      `${C2M_PREFIX}: ${dirCount} dirs and ${fileCount} files cannot fit ${bytes.length} bytes`,
    );
  }
  for (let i = 0; i < dirCount; i++) {
    cursor.take(cursor.u32());
    const index = cursor.u32();
    if (index !== i) throw new Error(`${C2M_PREFIX}: directory record ${i} carries index ${index}`);
  }
  const files: C2mFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const name = cursor.ascii(cursor.u32());
    const offset = cursor.u32();
    const size = cursor.u32();
    if (offset + size > bytes.length) {
      throw new Error(`${C2M_PREFIX}: ${name} spans ${offset}+${size}, past the ${bytes.length}-byte file`);
    }
    files.push({ name, bytes: bytes.subarray(offset, offset + size) });
  }
  return files;
}
