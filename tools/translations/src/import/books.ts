import { join } from 'node:path';
import { findPathCaseInsensitive, readHistoryBlocks } from '@open-northland/asset-pipeline/sources';
import type { BookBlocks } from '../pack-text.js';

const UTF8 = 'utf-8';

/** The localization repository's UTF-8 `text/<folder>/hypertext/<book>/*.txt` blocks. */
export async function readLocalizedBook(
  textRoot: string,
  folder: string,
  book: string,
): Promise<BookBlocks | undefined> {
  const dir = await findPathCaseInsensitive(join(textRoot, folder), ['hypertext', book]);
  return dir === undefined ? undefined : readHistoryBlocks(dir, UTF8);
}

/**
 * The translated block bodies of the files and labels `basis` carries, blank ones skipped, with the
 * block files and labels the basis lacks.
 */
export function translateBook(
  translated: BookBlocks,
  basis: BookBlocks,
): {
  readonly blocks: Record<string, Record<string, string>>;
  readonly unknown: readonly string[];
} {
  const blocks: Record<string, Record<string, string>> = {};
  const unknown: string[] = [];
  for (const [file, labels] of translated) {
    const known = basis.get(file);
    if (known === undefined) {
      unknown.push(file);
      continue;
    }
    const kept: Record<string, string> = {};
    for (const [label, body] of labels) {
      if (body.trim() === '') continue;
      if (!known.has(label)) unknown.push(`${file} ${label}`);
      else kept[label] = body;
    }
    if (Object.keys(kept).length > 0) blocks[file] = kept;
  }
  return { blocks, unknown };
}
