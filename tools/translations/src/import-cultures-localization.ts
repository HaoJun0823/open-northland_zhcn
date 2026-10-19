#!/usr/bin/env node
/**
 * Imports the Chinese text of CulturesGameLocalization into `translations/{chs,cht}/` as JSON overlays
 * against the data pack's German text, plus `translations/glossary.csv`. Usage and provenance:
 * `translations/SOURCES.md`.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatReport } from './import/report.js';
import { GLOSSARY_FILE, importCulturesLocalization } from './import/run.js';

const USAGE =
  'usage: import-cultures-localization --source <CulturesGameLocalization> --data-root <unpacked pack> --out <translations dir>';

/** The checkout's commit, marked when its tree has local changes, for `SOURCES.md`. */
function sourceCommit(source: string): string {
  try {
    const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    return dirty === '' ? head : `${head} (with local changes)`;
  } catch {
    return 'unknown commit';
  }
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      'data-root': { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.source === undefined || values['data-root'] === undefined || values.out === undefined) {
    throw new Error(USAGE);
  }
  // npm runs a workspace script inside the workspace; INIT_CWD is where it was invoked.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const source = resolve(baseDir, values.source);
  const out = resolve(baseDir, values.out);
  const result = await importCulturesLocalization({
    source,
    dataRoot: resolve(baseDir, values['data-root']),
  });
  for (const file of result.files)
    await writeText(join(out, file.path), `${JSON.stringify(file.value, null, 2)}\n`);
  await writeText(join(out, GLOSSARY_FILE), result.glossary);
  console.log(formatReport(result, sourceCommit(source)));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
