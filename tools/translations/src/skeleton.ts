#!/usr/bin/env node
/**
 * Writes a map overlay skeleton for every map of a map archive or folder: each string and briefing block
 * of the basis language with its source text as the value, for a translator to replace in place. Usage:
 * `translations/AGENTS.md`.
 */

import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  isLanguage,
  isSourceLanguage,
  LANGUAGES,
  type Language,
  MAP_TEXT_LANGUAGES,
  MapOverlay,
  OVERLAY_VERSION,
  SOURCE_LANGUAGES,
  type SourceLanguage,
} from '@open-northland/data';
import {
  DEFAULT_ROOT_NAME,
  findMapFolders,
  isMapTextFile,
  MAP_DAT_FILE,
  type MapLanguageText,
  type MapTree,
  mapIdFromPath,
  mapSourceTextDigest,
  openArchive,
  readMapSourceText,
  treeFromFolder,
} from '@open-northland/map-import';
import { TRANSLATIONS_ROOT } from '@open-northland/translations';

/** One map folder's skeleton; or the earlier folder with the same `map.dat`, whose skeleton serves it
 *  too; or why it gets none. */
export type MapSkeleton =
  | {
      readonly kind: 'skeleton';
      readonly folder: string;
      readonly digest: string;
      readonly overlay: MapOverlay;
    }
  | { readonly kind: 'shared'; readonly folder: string; readonly sharesWith: string }
  | { readonly kind: 'refused'; readonly folder: string; readonly refusal: string };

export interface SkeletonOptions {
  /** The overlay's language. */
  readonly lang: Language;
  /** The language to translate from; by default the first source language the map ships. */
  readonly basis?: SourceLanguage;
  /** The name a map at the tree root takes: the archive's or folder's own. */
  readonly rootName: string;
}

/** The overlay of a map named `map` whose every entry is the `basis` source text, valid as written. */
function skeletonOverlay(map: string, basis: SourceLanguage, text: MapLanguageText): MapOverlay {
  return MapOverlay.parse({
    version: OVERLAY_VERSION,
    map,
    basis: { lang: basis, digest: mapSourceTextDigest(text.strings, text.briefings) },
    strings: { ...text.strings },
    briefings: Object.fromEntries(text.briefings),
  });
}

/** The spelled path of folder `key`; a map at the tree root takes `rootName`. */
function spelledFolder(tree: MapTree, key: string, rootName: string): string {
  if (key === '') return rootName;
  const dat = `${key}/${MAP_DAT_FILE}`;
  const spelled = tree.names.get(dat) ?? dat;
  return spelled.slice(0, spelled.lastIndexOf('/'));
}

const hasEntries = (text: MapLanguageText | undefined): text is MapLanguageText =>
  text !== undefined && (Object.keys(text.strings).length > 0 || text.briefings.size > 0);

/** The skeleton of every map folder in `tree`, in path order; one per `map.dat` digest. */
export async function mapSkeletons(tree: MapTree, options: SkeletonOptions): Promise<MapSkeleton[]> {
  const { lang } = options;
  const skeletons: MapSkeleton[] = [];
  const folderByDigest = new Map<string, string>();
  for (const key of findMapFolders(tree)) {
    const folder = spelledFolder(tree, key, options.rootName);
    const refuse = (refusal: string): void => {
      skeletons.push({ kind: 'refused', folder, refusal });
    };
    const text = await readMapSourceText(tree, key);
    // findMapFolders lists only folders that hold a map.dat.
    if (text === undefined) continue;
    const twin = folderByDigest.get(text.datDigest);
    if (twin !== undefined) {
      skeletons.push({ kind: 'shared', folder, sharesWith: twin });
      continue;
    }
    const shipped = MAP_TEXT_LANGUAGES.filter(isSourceLanguage).filter((source) =>
      hasEntries(text.languages[source]),
    );
    const basis = options.basis ?? shipped[0];
    if (basis === undefined) {
      refuse(`the map ships no ${SOURCE_LANGUAGES.join(', ')} text to translate from`);
      continue;
    }
    const source = text.languages[basis];
    if (!hasEntries(source)) {
      refuse(`the map ships no ${basis} text; it ships ${shipped.join(', ') || 'none'}`);
      continue;
    }
    if (lang !== basis && text.languages[lang] !== undefined) {
      const edit = isSourceLanguage(lang) ? `; --basis ${lang} writes an edit template` : '';
      refuse(`the map ships ${lang} text itself, which wins over an overlay${edit}`);
      continue;
    }
    // A folder name without a Latin letter or digit slugs to nothing.
    const map = mapIdFromPath(`${folder}/${MAP_DAT_FILE}`) || DEFAULT_ROOT_NAME;
    folderByDigest.set(text.datDigest, folder);
    const overlay = skeletonOverlay(map, basis, source);
    skeletons.push({ kind: 'skeleton', folder, digest: text.datDigest, overlay });
  }
  return skeletons;
}

const UNRAR_WASM = 'node-unrar-js/esm/js/unrar.wasm';

/** The unrar binary `openArchive` needs for a RAR. */
async function unrarWasm(): Promise<ArrayBuffer> {
  const bytes = await readFile(createRequire(import.meta.url).resolve(UNRAR_WASM));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** A map archive (`.zip`, `.rar`, `.c2m`, `.tar`) or folder as a tree, and the name a root map takes. */
export async function readMapInput(path: string): Promise<{ tree: MapTree; rootName: string }> {
  const name = basename(path);
  if ((await stat(path)).isDirectory()) {
    const files = (await readdir(path, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(path, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .filter((rel) => isMapTextFile(rel.toLowerCase()))
      .sort();
    return { tree: await treeFromFolder(files, (rel) => readFile(join(path, rel))), rootName: name };
  }
  const tree = await openArchive(await readFile(path), { name, unrarWasm });
  return { tree, rootName: name.slice(0, name.length - extname(name).length) || DEFAULT_ROOT_NAME };
}

/** Writes `overlay` to `<out>/<lang>/maps/<digest>.json`, unless that file exists and `force` is off. */
export async function writeMapOverlay(
  out: string,
  lang: Language,
  digest: string,
  overlay: MapOverlay,
  force: boolean,
): Promise<{ readonly file: string; readonly written: boolean }> {
  const file = join(out, lang, 'maps', `${digest}.json`);
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, `${JSON.stringify(overlay, null, 2)}\n`, { flag: force ? 'w' : 'wx' });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return { file, written: false };
    throw err;
  }
  return { file, written: true };
}

const USAGE =
  'usage: translations:skeleton <map archive or folder> --lang <language> [--basis <source language>] ' +
  '[--out <translations dir>] [--force]';

function entryCount(overlay: MapOverlay): string {
  const strings = Object.keys(overlay.strings).length;
  const blocks = Object.keys(overlay.briefings).length;
  return `${strings} string(s) and ${blocks} briefing block(s)`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      lang: { type: 'string' },
      basis: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const [input, ...extra] = positionals;
  if (input === undefined || extra.length > 0 || values.lang === undefined) throw new Error(USAGE);
  const lang = values.lang;
  if (!isLanguage(lang)) throw new Error(`--lang ${lang}: expected one of ${LANGUAGES.join(', ')}`);
  const basis = values.basis;
  if (basis !== undefined && !isSourceLanguage(basis))
    throw new Error(`--basis ${basis}: expected one of ${SOURCE_LANGUAGES.join(', ')}`);
  // npm runs a workspace script inside the workspace; INIT_CWD is where it was invoked.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out === undefined ? TRANSLATIONS_ROOT : resolve(baseDir, values.out);
  const { tree, rootName } = await readMapInput(resolve(baseDir, input));
  const skeletons = await mapSkeletons(tree, { lang, rootName, ...(basis === undefined ? {} : { basis }) });
  if (skeletons.length === 0) throw new Error(`${input}: no map folder, no ${MAP_DAT_FILE} found`);
  for (const skeleton of skeletons) {
    if (skeleton.kind === 'shared') {
      console.log(
        `${skeleton.folder}: the same map.dat as ${skeleton.sharesWith}, whose overlay serves both`,
      );
      continue;
    }
    if (skeleton.kind === 'refused') {
      console.error(`${skeleton.folder}: refused, ${skeleton.refusal}`);
      process.exitCode = 1;
      continue;
    }
    const { folder, digest, overlay } = skeleton;
    const { file, written } = await writeMapOverlay(out, lang, digest, overlay, values.force);
    if (!written) {
      console.error(`${folder}: refused, ${file} exists; --force replaces it`);
      process.exitCode = 1;
      continue;
    }
    const what =
      overlay.basis.lang === lang
        ? `an edit template of the ${lang} text: edit the values to change and delete the rest`
        : `a skeleton for ${lang} from the ${overlay.basis.lang} text: replace each value with its translation, delete the rest`;
    console.log(`${folder}: wrote ${file}, ${entryCount(overlay)}; ${what}`);
  }
}

// Runs only as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
