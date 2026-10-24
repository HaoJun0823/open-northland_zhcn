import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { libraryHead } from '../../../ownership/test/support/memory-reader.js';

export { libraryHead };

/** Writes a library-layout install under `folder`, named in the case a release might use. */
export async function writeLibraryInstall(folder: string): Promise<void> {
  const libs = join(folder, 'DATAX', 'libs');
  await mkdir(libs, { recursive: true });
  await writeFile(join(libs, 'Data0001.lib'), libraryHead());
}
