import { unzipSync } from 'fflate';
import { errorMessage, MapImportError } from '../errors.js';
import type { TreeBuilder } from '../tree.js';
import type { ArchiveEntry } from './entries.js';

/** End-of-central-directory and central-header signatures (APPNOTE 4.3.16, 4.3.12). */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_HEADER_BYTES = 46;
/** Field offsets inside the end-of-central-directory record and a central header. */
const EOCD_ENTRY_COUNT = 10;
const EOCD_DIRECTORY_OFFSET = 16;
const CENTRAL_FLAGS = 8;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_EXTRA_LENGTH = 30;
const CENTRAL_COMMENT_LENGTH = 32;
/** General-purpose flag bit 0: the entry is encrypted; bit 11: its name is UTF-8, else CP437. */
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
/** The 32-bit field value that defers to a ZIP64 record. */
const ZIP64_DEFERRED = 0xffffffff;

/**
 * The names of encrypted entries, read from the central directory. fflate would inflate an encrypted
 * entry into noise instead of refusing it. Empty when the directory is absent or ZIP64.
 */
function encryptedEntries(bytes: Uint8Array): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = new Set<string>();
  const floor = Math.max(0, bytes.length - EOCD_BYTES - MAX_COMMENT_BYTES);
  let eocd = -1;
  for (let at = bytes.length - EOCD_BYTES; at >= floor; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return names;
  const count = view.getUint16(eocd + EOCD_ENTRY_COUNT, true);
  let at = view.getUint32(eocd + EOCD_DIRECTORY_OFFSET, true);
  if (at === ZIP64_DEFERRED) return names;
  for (let i = 0; i < count && at + CENTRAL_HEADER_BYTES <= bytes.length; i++) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) break;
    const flags = view.getUint16(at + CENTRAL_FLAGS, true);
    const nameLength = view.getUint16(at + CENTRAL_NAME_LENGTH, true);
    const extraLength = view.getUint16(at + CENTRAL_EXTRA_LENGTH, true);
    const commentLength = view.getUint16(at + CENTRAL_COMMENT_LENGTH, true);
    const name = bytes.subarray(at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + nameLength);
    // Decoded the way fflate names the entry, so the two sets compare.
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      names.add((flags & FLAG_UTF8) !== 0 ? new TextDecoder().decode(name) : String.fromCharCode(...name));
    }
    at += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Unpacks the kept entries of a zip. An encrypted kept entry or a corrupt archive is `unsupported-archive`. */
export async function unpackZip(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: (path: string) => boolean,
): Promise<ArchiveEntry[]> {
  const encrypted = encryptedEntries(bytes);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        builder.list();
        if (file.name.endsWith('/') || !keep(file.name)) return false;
        if (encrypted.has(file.name)) {
          throw new MapImportError('unsupported-archive', `zip: ${file.name} is encrypted`);
        }
        builder.reserve(file.name, file.originalSize);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `zip: ${errorMessage(err)}`);
  }
  return Object.entries(files).map(([path, data]) => ({ path, bytes: data }));
}
