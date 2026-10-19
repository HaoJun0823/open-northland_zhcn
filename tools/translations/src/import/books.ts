import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonFingerprint } from '@open-northland/data';
import { parseBriefingBlocks } from '@open-northland/formats/hypertext';
import { decodeIni } from '@open-northland/formats/ini';
import { textEncoding } from '@open-northland/formats/text-encoding';
import { findCaseInsensitive } from './pack-files.js';

/** A hypertext book's block bodies by lower-cased block file name, then label. */
export type BookBlocks = Record<string, Record<string, string>>;

/** The mission window's history book; its pages include their text from `*.txt` block files. */
export const HISTORY_BOOK = 'history';
const BLOCK_FILE = /\.txt$/i;
const UTF8 = 'utf-8';

async function readBlockFiles(dir: string, encoding: string): Promise<BookBlocks> {
  const blocks: BookBlocks = {};
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && BLOCK_FILE.test(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const text = decodeIni(await readFile(join(dir, entry.name)), encoding);
    blocks[entry.name.toLowerCase()] = Object.fromEntries(parseBriefingBlocks(text));
  }
  return blocks;
}

/** The pack's `Data/text/<lang>/hypertext/<book>/*.txt` blocks; undefined when the folder is absent. */
export async function readPackBook(
  baseRoot: string,
  lang: string,
  book: string,
): Promise<BookBlocks | undefined> {
  const dir = await findCaseInsensitive(baseRoot, ['Data', 'text', lang, 'hypertext', book]);
  return dir === undefined ? undefined : readBlockFiles(dir, textEncoding(lang));
}

/** The localization repository's UTF-8 `text/<folder>/hypertext/<book>/*.txt` blocks. */
export async function readLocalizedBook(
  textRoot: string,
  folder: string,
  book: string,
): Promise<BookBlocks | undefined> {
  const dir = await findCaseInsensitive(join(textRoot, folder), ['hypertext', book]);
  return dir === undefined ? undefined : readBlockFiles(dir, UTF8);
}

export function bookDigest(blocks: BookBlocks): string {
  return jsonFingerprint({ blocks });
}

/**
 * The translated block bodies of the files and labels `basis` carries, blank ones skipped, with the
 * block files and labels the basis lacks.
 */
export function translateBook(
  translated: BookBlocks,
  basis: BookBlocks,
): { readonly blocks: BookBlocks; readonly unknown: readonly string[] } {
  const blocks: BookBlocks = {};
  const unknown: string[] = [];
  for (const [file, labels] of Object.entries(translated)) {
    const known = basis[file];
    if (known === undefined) {
      unknown.push(file);
      continue;
    }
    const kept: Record<string, string> = {};
    for (const [label, body] of Object.entries(labels)) {
      if (body.trim() === '') continue;
      if (known[label] === undefined) unknown.push(`${file} ${label}`);
      else kept[label] = body;
    }
    if (Object.keys(kept).length > 0) blocks[file] = kept;
  }
  return { blocks, unknown };
}
