import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Resolves `segments` under `dir` one case-folded segment at a time: the pack's base tree mixes `Text/`,
 * `TEXT/` and `Strings.ini`. The exact spelling wins over a folded one; undefined when nothing matches.
 */
export async function findCaseInsensitive(
  dir: string,
  segments: readonly string[],
): Promise<string | undefined> {
  let current = dir;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return undefined;
    }
    const folded = segment.toLowerCase();
    const match = entries.includes(segment) ? segment : entries.find((e) => e.toLowerCase() === folded);
    if (match === undefined) return undefined;
    current = join(current, match);
  }
  return current;
}

export async function readCaseInsensitive(
  dir: string,
  segments: readonly string[],
): Promise<Uint8Array | undefined> {
  const path = await findCaseInsensitive(dir, segments);
  return path === undefined ? undefined : readFile(path);
}
