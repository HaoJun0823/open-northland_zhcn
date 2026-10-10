import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bytes of the synthetic library: enough for its header and a little more. */
const FIXTURE_LIBRARY_BYTES = 256;
const VERSION_OFFSET = 0;
const ROOT_NAME_LENGTH_OFFSET = 12;
const ROOT_NAME_OFFSET = 16;
const ROOT_ENTRY_COUNT_OFFSET = 17;
const FIRST_NAME_LENGTH_OFFSET = 21;
const FIRST_NAME_OFFSET = 25;
const FIRST_NAME = 'data\\';

/** A synthetic `data0001.lib` head: version 1, the root `\\` entry, then the `data\\` entry. */
export function libraryHead(): Uint8Array {
  const bytes = new Uint8Array(FIXTURE_LIBRARY_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(VERSION_OFFSET, 1, true);
  view.setUint32(ROOT_NAME_LENGTH_OFFSET, 1, true);
  bytes[ROOT_NAME_OFFSET] = '\\'.charCodeAt(0);
  view.setUint32(ROOT_ENTRY_COUNT_OFFSET, 0, true);
  view.setUint32(FIRST_NAME_LENGTH_OFFSET, FIRST_NAME.length, true);
  bytes.set(
    [...FIRST_NAME].map((char) => char.charCodeAt(0)),
    FIRST_NAME_OFFSET,
  );
  return bytes;
}

/** Writes a library-layout install under `folder`, named in the case a release might use. */
export async function writeLibraryInstall(folder: string): Promise<void> {
  const libs = join(folder, 'DATAX', 'libs');
  await mkdir(libs, { recursive: true });
  await writeFile(join(libs, 'Data0001.lib'), libraryHead());
}
