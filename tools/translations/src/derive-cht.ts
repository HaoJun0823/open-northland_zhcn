#!/usr/bin/env node
/**
 * Writes the Traditional Chinese twin of every Simplified Chinese map overlay and object table file the
 * project wrote: an OpenCC `cn` to `twp` conversion (Taiwan script and vocabulary), marked
 * `derived: "chs"`, and deletes a marked twin whose `chs` file is gone. A `cht` file without that mark (an imported or hand-written one)
 * is left alone. Usage: `translations/AGENTS.md`.
 */

import { realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { MapOverlay, ObjectTableOverlay } from '@open-northland/data';
import { listDirectory, readOverlayFile, TRANSLATIONS_ROOT } from '@open-northland/translations';
import { Converter } from 'opencc-js';

const SOURCE_LANGUAGE = 'chs';
const TARGET_LANGUAGE = 'cht';
/** The folders whose project-written files get a derived twin: map overlays and object table edits. */
const DERIVED_KINDS = ['maps', 'objects'] as const;
type DerivedKind = (typeof DERIVED_KINDS)[number];
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

type Convert = (text: string) => string;

/** Phrases OpenCC's `cn` to `twp` conversion gets wrong in our text (a wrong word split, a computing
 *  term, a name, the HUD's wording), each with the Traditional text it must become. */
export const PHRASE_OVERRIDES: readonly (readonly [string, string])[] = [
  // Word splits and computing vocabulary.
  ['的士兵', '的士兵'],
  ['的士气', '的士氣'],
  ['找对象', '找對象'],
  ['接口道', '接口道'],
  ['远程贸易', '遠程貿易'],
  ['伙伴', '夥伴'],
  ['复杂', '複雜'],
  ['质量', '品質'],
  ['扩展', '擴展'],
  ['连接', '連接'],
  ['高级', '高級'],
  ['局部', '局部'],
  ['类型', '類型'],
  ['调制', '調製'],
  ['溢出', '溢出'],
  ['重装', '重裝'],
  ['驱散', '驅散'],
  ['命令行', '命令行'],
  ['卸载', '卸載'],
  ['脚本', '腳本'],
  ['设备', '設備'],
  ['打采', '打采'],
  // One Simplified character for two Traditional ones.
  ['这只意味', '這只意味'],
  ['这只说明', '這只說明'],
  ['这只有', '這只有'],
  ['是只有', '是只有'],
  ['那只能', '那只能'],
  ['半只能', '半只能'],
  ['一只只病', '一隻隻病'],
  ['头发生', '頭發生'],
  ['白发生', '白發生'],
  ['落发展', '落發展'],
  ['直发颤', '直發顫'],
  ['被发配', '被發配'],
  ['伊面前', '伊面前'],
  ['群后', '群後'],
  ['系在岸', '繫在岸'],
  ['那卷', '那卷'],
  ['光明了', '光明了'],
  ['干翻', '幹翻'],
  ['干的事', '幹的事'],
  ['白干', '白幹'],
  ['他们干的', '他們幹的'],
  ['扎尔干的', '扎爾幹的'],
  ['河干涸', '河乾涸'],
  ['建筑里', '建築裡'],
  ['废墟里', '廢墟裡'],
  ['地牢里', '地牢裡'],
  ['地道里', '地道裡'],
  ['地下城里', '地下城裡'],
  ['知道里面', '知道裡面'],
  ['往日里', '往日裡'],
  ['海里', '海裡'],
  // Names.
  ['布尔', '布爾'],
  ['布雷尼', '布雷尼'],
  ['采罗夫', '采羅夫'],
  ['范达尔', '范達爾'],
  ['哈希', '哈希'],
  // The HUD's wording (`cht-game.ts`).
  ['点击', '點擊'],
  ['空格键', '空白鍵'],
  ['列表', '清單'],
  ['滚动', '捲動'],
];

/** The first of the private-use code points that stand in for an override phrase while OpenCC runs. */
const PLACEHOLDER_BASE = 0xe000;

/** `convert` with each `phrases` entry held out of it behind a private-use placeholder, longest
 *  phrase first, and its Traditional text put in afterwards. */
export function withPhraseOverrides(
  convert: Convert,
  phrases: readonly (readonly [string, string])[] = PHRASE_OVERRIDES,
): Convert {
  const ordered = phrases
    .map(([simplified, traditional], index) => ({
      simplified,
      traditional,
      placeholder: String.fromCodePoint(PLACEHOLDER_BASE + index),
    }))
    .sort((a, b) => b.simplified.length - a.simplified.length);
  return (text) => {
    const held = ordered.reduce(
      (out, { simplified, placeholder }) => out.replaceAll(simplified, placeholder),
      text,
    );
    return ordered.reduce(
      (out, { placeholder, traditional }) => out.replaceAll(placeholder, traditional),
      convert(held),
    );
  };
}

/** Each value of `record` converted; hypertext tags and markers carry no Chinese, so converting the whole
 *  value is safe. */
function convertedValues(record: Readonly<Record<string, string>>, convert: Convert): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, traditionalPunctuation(convert(value))]),
  );
}

/** The Traditional twin of a map overlay. */
export function deriveTraditional(source: MapOverlay, convert: Convert): MapOverlay {
  return MapOverlay.parse({
    version: source.version,
    map: source.map,
    basis: source.basis,
    strings: convertedValues(source.strings, convert),
    briefings: convertedValues(source.briefings, convert),
    derived: SOURCE_LANGUAGE,
  });
}

/** The Traditional twin of an object table overlay or edit. */
export function deriveTraditionalTable(source: ObjectTableOverlay, convert: Convert): ObjectTableOverlay {
  return ObjectTableOverlay.parse({
    version: source.version,
    basis: source.basis,
    names: convertedValues(source.names, convert),
    plurals: convertedValues(source.plurals, convert),
    derived: SOURCE_LANGUAGE,
  });
}

/** A file of either folder that does not read as an overlay, which the command leaves as it is. */
export interface UnreadableOverlay {
  readonly file: string;
  readonly message: string;
}

/** What the command did, by `<kind>/<file>` under each language. */
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

/** How one kind's files are read and derived. */
interface Derivation<T extends { readonly derived?: string | undefined }> {
  readonly read: (path: string) => Promise<T>;
  readonly derive: (source: T, convert: Convert) => T;
}

const DERIVATIONS: { readonly [K in DerivedKind]: Derivation<MapOverlay | ObjectTableOverlay> } = {
  maps: {
    read: (path) => readOverlayFile('maps', path),
    derive: (source, convert) => deriveTraditional(MapOverlay.parse(source), convert),
  },
  objects: {
    read: (path) => readOverlayFile('objects', path),
    derive: (source, convert) => deriveTraditionalTable(ObjectTableOverlay.parse(source), convert),
  },
};

/**
 * Derives `cht/<kind>/<file>` from each `chs/<kind>/<file>` that is not itself derived, unless the `cht`
 * file lacks the mark, and deletes each marked `cht` file without its `chs` file. A file that does not
 * read as an overlay is reported, never overwritten or deleted.
 */
export async function deriveTraditionalOverlays(root: string, convert: Convert): Promise<DeriveResult> {
  const result: DeriveResult = { written: [], kept: [], deleted: [], unreadable: [] };
  for (const kind of DERIVED_KINDS) await deriveKind(root, kind, convert, result);
  return result;
}

async function deriveKind(
  root: string,
  kind: DerivedKind,
  convert: Convert,
  result: DeriveResult,
): Promise<void> {
  const { read, derive } = DERIVATIONS[kind];
  const sourceDir = join(root, SOURCE_LANGUAGE, kind);
  const targetDir = join(root, TARGET_LANGUAGE, kind);
  const tryRead = async (lang: string, dir: string, file: string) => {
    const path = join(dir, file);
    try {
      return await read(path);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).replace(`${path}: `, '');
      result.unreadable.push({ file: `${lang}/${kind}/${file}`, message });
      return undefined;
    }
  };
  const sources = await overlayFileNames(sourceDir);
  const targets = await overlayFileNames(targetDir);
  if (sources.length > 0) await mkdir(targetDir, { recursive: true });
  for (const file of sources) {
    const source = await tryRead(SOURCE_LANGUAGE, sourceDir, file);
    if (source === undefined || source.derived !== undefined) continue;
    if (targets.includes(file)) {
      const existing = await tryRead(TARGET_LANGUAGE, targetDir, file);
      if (existing === undefined) continue;
      if (existing.derived === undefined) {
        result.kept.push(`${kind}/${file}`);
        continue;
      }
    }
    const derived = derive(source, convert);
    await writeFile(join(targetDir, file), `${JSON.stringify(derived, null, JSON_INDENT)}\n`);
    result.written.push(`${kind}/${file}`);
  }
  for (const file of targets.filter((name) => !sources.includes(name))) {
    const orphan = await tryRead(TARGET_LANGUAGE, targetDir, file);
    if (orphan?.derived !== SOURCE_LANGUAGE) continue;
    await rm(join(targetDir, file));
    result.deleted.push(`${kind}/${file}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { root: { type: 'string' } }, strict: true });
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const root = values.root === undefined ? TRANSLATIONS_ROOT : resolve(baseDir, values.root);
  const convert = withPhraseOverrides(Converter({ from: 'cn', to: 'twp' }));
  const { written, kept, deleted, unreadable } = await deriveTraditionalOverlays(root, convert);
  for (const file of deleted)
    console.log(`deleted ${TARGET_LANGUAGE}/${file}: its ${SOURCE_LANGUAGE} file is gone`);
  for (const { file, message } of unreadable) console.error(`error   ${file}: ${message}; left as it is`);
  console.log(
    `derive-cht: ${written.length} ${TARGET_LANGUAGE} overlay file(s) derived from ${SOURCE_LANGUAGE}, ` +
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
