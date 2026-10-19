#!/usr/bin/env node
/**
 * Writes the Traditional Chinese twin of every Simplified Chinese map overlay the project wrote: an
 * OpenCC `cn` to `twp` conversion (Taiwan script and vocabulary), marked `derived: "chs"`, and deletes a
 * marked twin whose `chs` file is gone. A `cht` file without that mark (an imported or hand-written one)
 * is left alone. Usage: `translations/AGENTS.md`.
 */

import { realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { MapOverlay } from '@open-northland/data';
import { listDirectory, readOverlayFile, TRANSLATIONS_ROOT } from '@open-northland/translations';
import { Converter } from 'opencc-js';

const SOURCE_LANGUAGE = 'chs';
const TARGET_LANGUAGE = 'cht';
const MAPS_DIR = 'maps';
const OVERLAY_EXTENSION = '.json';
const JSON_INDENT = 2;

/** Mainland quotation marks become the corner brackets Taiwan text uses; OpenCC leaves punctuation alone. */
const QUOTATION_MARKS: readonly (readonly [string, string])[] = [
  ['\u201c', '「'],
  ['\u201d', '」'],
  ['\u2018', '『'],
  ['\u2019', '』'],
];

function traditionalPunctuation(text: string): string {
  return QUOTATION_MARKS.reduce((out, [from, to]) => out.replaceAll(from, to), text);
}

/** Converts the prose of each value; hypertext tags and markers carry no Chinese, so converting the
 *  whole value is safe. */
export function deriveTraditional(source: MapOverlay, convert: (text: string) => string): MapOverlay {
  const mapValues = (record: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, traditionalPunctuation(convert(value))]),
    );
  return MapOverlay.parse({
    version: source.version,
    map: source.map,
    basis: source.basis,
    strings: mapValues(source.strings),
    briefings: mapValues(source.briefings),
    derived: SOURCE_LANGUAGE,
  });
}

/** A file of either folder that does not read as a map overlay, which the command leaves as it is. */
export interface UnreadableOverlay {
  readonly file: string;
  readonly message: string;
}

/** What the command did, by file name under `<lang>/maps/`. */
export interface DeriveResult {
  readonly written: string[];
  /** `cht` files without the mark at a `chs` file's name. */
  readonly kept: string[];
  /** Marked `cht` files whose `chs` file is gone, renamed to a variant included. */
  readonly deleted: string[];
  readonly unreadable: UnreadableOverlay[];
}

async function overlayFileNames(dir: string): Promise<string[]> {
  return (await listDirectory(dir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(OVERLAY_EXTENSION))
    .map((entry) => entry.name);
}

/**
 * Derives `cht/maps/<file>` from each `chs/maps/<file>` that is not itself derived, unless the `cht`
 * file lacks the mark, and deletes each marked `cht` file without its `chs` file. A file that does not
 * read as an overlay is reported, never overwritten or deleted.
 */
export async function deriveTraditionalMaps(
  root: string,
  convert: (text: string) => string,
): Promise<DeriveResult> {
  const sourceDir = join(root, SOURCE_LANGUAGE, MAPS_DIR);
  const targetDir = join(root, TARGET_LANGUAGE, MAPS_DIR);
  const result: DeriveResult = { written: [], kept: [], deleted: [], unreadable: [] };
  const read = async (lang: string, dir: string, file: string): Promise<MapOverlay | undefined> => {
    const path = join(dir, file);
    try {
      return await readOverlayFile('maps', path);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).replace(`${path}: `, '');
      result.unreadable.push({ file: `${lang}/${MAPS_DIR}/${file}`, message });
      return undefined;
    }
  };
  const sources = await overlayFileNames(sourceDir);
  const targets = await overlayFileNames(targetDir);
  await mkdir(targetDir, { recursive: true });
  for (const file of sources) {
    const source = await read(SOURCE_LANGUAGE, sourceDir, file);
    if (source === undefined || source.derived !== undefined) continue;
    if (targets.includes(file)) {
      const existing = await read(TARGET_LANGUAGE, targetDir, file);
      if (existing === undefined) continue;
      if (existing.derived === undefined) {
        result.kept.push(file);
        continue;
      }
    }
    const derived = deriveTraditional(source, convert);
    await writeFile(join(targetDir, file), `${JSON.stringify(derived, null, JSON_INDENT)}\n`);
    result.written.push(file);
  }
  for (const file of targets.filter((name) => !sources.includes(name))) {
    const orphan = await read(TARGET_LANGUAGE, targetDir, file);
    if (orphan?.derived !== SOURCE_LANGUAGE) continue;
    await rm(join(targetDir, file));
    result.deleted.push(file);
  }
  return result;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { root: { type: 'string' } }, strict: true });
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const root = values.root === undefined ? TRANSLATIONS_ROOT : resolve(baseDir, values.root);
  const convert = Converter({ from: 'cn', to: 'twp' });
  const { written, kept, deleted, unreadable } = await deriveTraditionalMaps(root, convert);
  for (const file of deleted)
    console.log(`deleted ${TARGET_LANGUAGE}/${MAPS_DIR}/${file}: its ${SOURCE_LANGUAGE} file is gone`);
  for (const { file, message } of unreadable) console.error(`error   ${file}: ${message}; left as it is`);
  console.log(
    `derive-cht: ${written.length} ${TARGET_LANGUAGE} map overlay(s) derived from ${SOURCE_LANGUAGE}, ` +
      `${kept.length} kept as not derived, ${deleted.length} deleted, ${unreadable.length} unreadable`,
  );
  if (unreadable.length > 0) process.exitCode = 1;
}

// Runs only as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
