#!/usr/bin/env node
/**
 * Writes the Traditional Chinese twin of every Simplified Chinese map overlay the project wrote: an
 * OpenCC `cn` to `twp` conversion (Taiwan script and vocabulary), marked `derived: "chs"`. A `cht`
 * file without that mark (an imported or hand-written one) is left alone. Usage: `translations/AGENTS.md`.
 */

import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { MapOverlay } from '@open-northland/data';
import { TRANSLATIONS_ROOT } from '@open-northland/translations';
import { Converter } from 'opencc-js';

const SOURCE_LANGUAGE = 'chs';
const TARGET_LANGUAGE = 'cht';
const MAPS_DIR = 'maps';
const JSON_INDENT = 2;

/** Converts the prose of each value; hypertext tags and markers carry no Chinese, so converting the
 *  whole value is safe. */
export function deriveTraditional(source: MapOverlay, convert: (text: string) => string): MapOverlay {
  const mapValues = (record: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, convert(value)]));
  return MapOverlay.parse({
    version: source.version,
    map: source.map,
    basis: source.basis,
    strings: mapValues(source.strings),
    briefings: mapValues(source.briefings),
    derived: SOURCE_LANGUAGE,
  });
}

async function readOverlay(path: string): Promise<MapOverlay | undefined> {
  try {
    return MapOverlay.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export interface DeriveResult {
  readonly written: string[];
  readonly kept: string[];
}

/** Derives every `cht/maps/<file>` whose source `chs/maps/<file>` exists and is not itself derived. */
export async function deriveTraditionalMaps(
  root: string,
  convert: (text: string) => string,
): Promise<DeriveResult> {
  const sourceDir = join(root, SOURCE_LANGUAGE, MAPS_DIR);
  const targetDir = join(root, TARGET_LANGUAGE, MAPS_DIR);
  await mkdir(targetDir, { recursive: true });
  const written: string[] = [];
  const kept: string[] = [];
  for (const file of (await readdir(sourceDir)).filter((name) => name.endsWith('.json')).sort()) {
    const source = await readOverlay(join(sourceDir, file));
    if (source === undefined || source.derived !== undefined) continue;
    const existing = await readOverlay(join(targetDir, file));
    if (existing !== undefined && existing.derived === undefined) {
      kept.push(file);
      continue;
    }
    const derived = deriveTraditional(source, convert);
    await writeFile(join(targetDir, file), `${JSON.stringify(derived, null, JSON_INDENT)}\n`);
    written.push(file);
  }
  return { written, kept };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { root: { type: 'string' } }, strict: true });
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const root = values.root === undefined ? TRANSLATIONS_ROOT : resolve(baseDir, values.root);
  const convert = Converter({ from: 'cn', to: 'twp' });
  const { written, kept } = await deriveTraditionalMaps(root, convert);
  console.log(
    `derive-cht: ${written.length} ${TARGET_LANGUAGE} map overlay(s) derived from ${SOURCE_LANGUAGE}, ${kept.length} kept as not derived`,
  );
}

// Runs only as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
