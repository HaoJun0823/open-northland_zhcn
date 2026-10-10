import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncludeResolver, PictureResolver } from '@open-northland/formats/hypertext';
import { collectPagePictures } from '@open-northland/map-import';
import { writeFileWithParents } from '../files.js';
import { HYPERTEXT_PICTURES_DIR } from './gui/paths.js';

/** Locates one picture by its lower-cased file name, in whatever folder layout the caller reads. */
export type PictureLookup = (name: string) => Promise<string | undefined>;

/** Writes converted page pictures into `content/gui/hypertext/`. */
export async function writePagePictures(
  outDir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const [file, png] of files)
    await writeFileWithParents(join(outDir, HYPERTEXT_PICTURES_DIR, file), png);
}

/**
 * Emits every picture `pages` names into `content/gui/hypertext/` and returns the resolver a second
 * render looks them up through. An absent or undecodable picture warns and is left out.
 */
export async function resolvePagePictures(
  outDir: string,
  find: PictureLookup,
  pages: Iterable<string>,
  include: IncludeResolver,
  label: string,
): Promise<PictureResolver> {
  const read = async (name: string): Promise<Uint8Array | undefined> => {
    const path = await find(name);
    return path === undefined ? undefined : readFile(path);
  };
  const { picture, files } = await collectPagePictures(read, pages, include, (message) =>
    console.warn(`[pipeline] ${label}: ${message}`),
  );
  await writePagePictures(outDir, files);
  return picture;
}
