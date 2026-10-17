import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { type CampaignSource, readCampaigns, readDataPack } from '../../../scripts/data-pack.mjs';
import type { SourceCorrections } from './corrections.js';
import { walkFiles } from './files.js';
import type { StringCorrections } from './string-corrections.js';

/** The data subtrees the stages read by name; the on-disk spelling varies, so resolve them through
 *  `resolveSourceFile` or match them lower-cased. */
export const DATA_BOBS_DIR = 'Data/engine2d/bin/bobs';
export const DATA_TEXTURES_DIR = 'Data/engine2d/bin/textures';
export const DATA_SOUNDS_DIR = 'Data/engine2d/bin/sounds';
export const DATA_GUI_BITMAPS_DIR = 'Data/gui/bitmaps';

/** The base source tree under the validated data pack root. */
export interface SourceRoots {
  readonly data: string;
  /** Fixes applied as stages read the data; without them it is read as shipped. */
  readonly corrections?: SourceCorrections;
  /** Fixes applied to decoded display strings; without them the tables keep the shipped text. */
  readonly stringCorrections?: StringCorrections;
  /** Fixes applied to decoded map string tables; without them the maps keep the shipped text. */
  readonly mapStringCorrections?: StringCorrections;
}

/** Reads a data file as the run sees it, through the corrections that name it: by its data-relative
 *  path, or by `file` for a source outside the data root (a campaign map's tree path). */
export function readSourceFile(roots: SourceRoots, path: string, file?: string): Promise<Uint8Array> {
  return roots.corrections?.read(path, file) ?? readFile(path);
}

/** One source file found under the root. */
export interface SourceFile {
  /** Root-relative and `/`-separated on every host: matched lower-cased and recorded in the IR as is. */
  readonly rel: string;
  readonly path: string;
}

/**
 * Picks the directory entry that case-folds to `segment`: the exact spelling when present, else the
 * single folded match. Two folded matches with no exact one throw instead of being ordered
 * arbitrarily; undefined when nothing matches.
 */
export function pickCaseFoldedEntry(
  entries: readonly string[],
  segment: string,
  where: string,
): string | undefined {
  const folded = segment.toLowerCase();
  const matches = entries.filter((e) => e.toLowerCase() === folded);
  if (matches.includes(segment)) return segment;
  const [first, second] = matches;
  if (second !== undefined) {
    throw new Error(
      `case-colliding entries "${[...matches].sort().join('", "')}" for ${segment} in ${where}`,
    );
  }
  return first;
}

/**
 * Resolves `segments` under `dir` matching each segment case-insensitively, returning the real-cased
 * on-disk path. The shipped trees mix casing freely (`Text/`, `TEXT/`, `Pol/`, `Strings.ini`), which a
 * case-insensitive macOS/Windows filesystem hides and a case-sensitive Linux one does not.
 */
export async function findPathCaseInsensitive(
  dir: string,
  segments: readonly string[],
): Promise<string | undefined> {
  let current = dir;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return undefined; // `current` missing or not a directory - the path does not resolve
    }
    const match = pickCaseFoldedEntry(entries, segment, current);
    if (match === undefined) return undefined;
    current = join(current, match);
  }
  return current;
}

/**
 * Resolves `rel` under the base data root case-insensitively, or undefined when it does not exist. Splits
 * on either separator, since callers pass either a joined constant or an ini-borne reference already
 * forward-slashed by `normalizeAssetPath`.
 */
export async function resolveSourceFile(roots: SourceRoots, rel: string): Promise<string | undefined> {
  return findPathCaseInsensitive(roots.data, rel.split(/[\\/]+/));
}

/**
 * Recursively collects every file under the base data root whose lower-cased relative path satisfies
 * `match`. Two paths that fold equal throw, since a case-insensitive filesystem could serve either.
 * Sorted by `rel` so a re-run is reproducible regardless of directory-entry order. A missing root
 * propagates as an environmental error.
 */
export async function collectSourceFiles(
  roots: SourceRoots,
  match: (relLower: string) => boolean,
): Promise<SourceFile[]> {
  const byKey = new Map<string, SourceFile>();
  for await (const path of walkFiles(roots.data)) {
    const rel = relative(roots.data, path).split(sep).join('/');
    const key = rel.toLowerCase();
    if (!match(key)) continue;
    const twin = byKey.get(key);
    if (twin !== undefined) {
      throw new Error(
        `case-colliding sources "${twin.rel}" and "${rel}" under ${roots.data} - two on-disk ` +
          'spellings of one source path; remove or rename one and re-run',
      );
    }
    byKey.set(key, { rel, path });
  }
  return [...byKey.values()].sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** Collects every file whose last path segment is `name`, case-insensitively. */
export async function collectSourceFilesNamed(roots: SourceRoots, name: string): Promise<SourceFile[]> {
  const suffix = `/${name.toLowerCase()}`;
  return collectSourceFiles(roots, (rel) => `/${rel}`.endsWith(suffix));
}

/** A validated source pack: the base tree the stages read and the campaigns beside it. */
export interface DataPack {
  readonly root: string;
  readonly base: string;
  readonly campaigns: readonly CampaignSource[];
}

/** Validates a source pack before exposing it to the conversion stages. */
export async function resolveDataPack(dataRoot: string): Promise<DataPack> {
  const manifest = await readDataPack(dataRoot);
  return { root: dataRoot, base: join(dataRoot, 'base'), campaigns: await readCampaigns(dataRoot, manifest) };
}
