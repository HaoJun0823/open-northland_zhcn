import { type FolderPath, type FolderReader, findFile } from './folder-reader.js';
import { BUNDLE_IDENTIFIERS, KNOWN_LIBRARY_SIZES, type OriginalGameId } from './releases.js';

export type InstallLayout = 'library' | 'loose' | 'bundle';

export interface OriginalInstall {
  /** Segments below the reader's root; empty when the root itself is the install. */
  readonly path: FolderPath;
  readonly layout: InstallLayout;
  /** Known from the library size or the bundle identifier; `undefined` for an unlisted release. */
  readonly game: OriginalGameId | undefined;
  readonly edition: string | undefined;
}

const LIBRARY = ['DataX', 'Libs', 'data0001.lib'];
const LOOSE_PROBE = ['Data', 'logic', 'housetypes.cif'];
const BUNDLE_PLIST = ['Contents', 'Info.plist'];
const BUNDLE_ASSETS = ['Contents', 'Resources', 'DesktopAssets.zip'];

/**
 * The library starts with `u32 1`, two entry counts that differ per release, then the directory
 * table: `u32 1` and the root name `\`, `u32 0`, then `u32 5` and `data\`. Offsets in bytes,
 * unaligned because names are not padded.
 */
const LIBRARY_HEAD_BYTES = 32;
const LIBRARY_VERSION_OFFSET = 0;
const LIBRARY_ROOT_NAME_LENGTH_OFFSET = 12;
const LIBRARY_ROOT_NAME_OFFSET = 16;
const LIBRARY_ROOT_NAME = '\\';
const LIBRARY_FIRST_NAME_LENGTH_OFFSET = 21;
const LIBRARY_FIRST_NAME_OFFSET = 25;
const LIBRARY_FIRST_NAME = 'data\\';

/** Every `.cif` opens with this little-endian tag. */
const CIF_MAGIC = [0xfd, 0x03, 0x00, 0x00];

/** The plist is small; the identifier sits in its first kilobytes whether XML or binary. */
const PLIST_HEAD_BYTES = 64 * 1024;

function u32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** Characters per `fromCharCode` call: a plist head may run to 64 KiB, beyond a safe argument spread. */
const DECODE_CHUNK = 4096;

/** One byte per character, as the headers and plist bytes the rule reads are ASCII where it matters. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += DECODE_CHUNK) {
    text += String.fromCharCode(...bytes.subarray(start, start + DECODE_CHUNK));
  }
  return text;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string | undefined {
  if (offset + length > bytes.length) return undefined;
  return latin1(bytes.subarray(offset, offset + length));
}

export function isLibraryHead(bytes: Uint8Array): boolean {
  const name = asciiAt(bytes, LIBRARY_FIRST_NAME_OFFSET, LIBRARY_FIRST_NAME.length);
  return (
    u32(bytes, LIBRARY_VERSION_OFFSET) === 1 &&
    u32(bytes, LIBRARY_ROOT_NAME_LENGTH_OFFSET) === LIBRARY_ROOT_NAME.length &&
    asciiAt(bytes, LIBRARY_ROOT_NAME_OFFSET, LIBRARY_ROOT_NAME.length) === LIBRARY_ROOT_NAME &&
    u32(bytes, LIBRARY_FIRST_NAME_LENGTH_OFFSET) === LIBRARY_FIRST_NAME.length &&
    name?.toLowerCase() === LIBRARY_FIRST_NAME
  );
}

function isCifHead(bytes: Uint8Array): boolean {
  return CIF_MAGIC.every((value, index) => bytes[index] === value);
}

function bundleIdentifierIn(plist: Uint8Array): OriginalGameId | undefined {
  const text = latin1(plist);
  for (const [identifier, game] of BUNDLE_IDENTIFIERS) {
    if (text.includes(identifier)) return game;
  }
  return undefined;
}

/** Recognizes the reader's root itself. */
export async function recognizeInstall(reader: FolderReader): Promise<OriginalInstall | undefined> {
  const library = await findFile(reader, LIBRARY);
  if (library !== undefined) {
    const head = await reader.readHead(library.path, LIBRARY_HEAD_BYTES);
    if (head !== undefined && isLibraryHead(head)) {
      const known = library.size === undefined ? undefined : KNOWN_LIBRARY_SIZES.get(library.size);
      return {
        path: [],
        layout: 'library',
        game: known?.game,
        edition: known?.edition,
      };
    }
  }

  const loose = await findFile(reader, LOOSE_PROBE);
  if (loose !== undefined) {
    const head = await reader.readHead(loose.path, CIF_MAGIC.length);
    if (head !== undefined && isCifHead(head)) {
      return { path: [], layout: 'loose', game: undefined, edition: undefined };
    }
  }

  const plist = await findFile(reader, BUNDLE_PLIST);
  const assets = await findFile(reader, BUNDLE_ASSETS);
  if (plist !== undefined && assets !== undefined) {
    const head = await reader.readHead(plist.path, PLIST_HEAD_BYTES);
    const game = head === undefined ? undefined : bundleIdentifierIn(head);
    if (game !== undefined) {
      return { path: [], layout: 'bundle', game, edition: 'Mac App Store' };
    }
  }

  return undefined;
}

function below(reader: FolderReader, prefix: FolderPath): FolderReader {
  return {
    list: (dir) => reader.list([...prefix, ...dir]),
    readHead: (file, bytes) => reader.readHead([...prefix, ...file], bytes),
  };
}

/**
 * Recognizes the root, else each of its immediate subdirectories: a player picking the folder
 * that holds the install (a Steam library, `/Applications`) should not be sent back.
 */
export async function findInstall(reader: FolderReader): Promise<OriginalInstall | undefined> {
  const atRoot = await recognizeInstall(reader);
  if (atRoot !== undefined) return atRoot;
  const entries = (await reader.list([])) ?? [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const inside = await recognizeInstall(below(reader, [entry.name]));
    if (inside !== undefined) return { ...inside, path: [entry.name] };
  }
  return undefined;
}
