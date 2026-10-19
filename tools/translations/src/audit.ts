#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  GAME_OBJECT_TABLES,
  type GameObjectNames,
  type GameObjectTable,
  HISTORY_BOOK,
  isGameObjectTable,
} from '@open-northland/asset-pipeline/sources';
import {
  type BookOverlay,
  isLanguage,
  isSourceLanguage,
  type Language,
  type MapOverlay,
  type ObjectTableOverlay,
} from '@open-northland/data';
import { mapSourceTextDigest } from '@open-northland/map-import';
import {
  listDirectory,
  OVERLAY_KINDS,
  type OverlayKind,
  readOverlayFile,
  TRANSLATIONS_ROOT,
} from '@open-northland/translations';
import {
  bookSourceDigest,
  objectTableSourceDigest,
  type PackMap,
  type PackText,
  readPackText,
} from './audit/pack-text.js';

/** One problem with one overlay file, named relative to the translations root. */
export interface AuditFinding {
  readonly file: string;
  readonly message: string;
}

export interface AuditReport {
  /** Overlay files that passed their schema. */
  readonly files: number;
  /** Schema and layout violations: the check fails on any. */
  readonly errors: readonly AuditFinding[];
  /** Overlays the pipeline leaves out or reads against changed source text. */
  readonly warnings: readonly AuditFinding[];
  /** Map overlays filed under a digest no map of the pack has: a catalogue map's, or a stale identity. */
  readonly unmatchedMaps: number;
}

/** The files the contract keeps at the translations root beside the language folders. */
const ROOT_FILES: ReadonlySet<string> = new Set(['AGENTS.md', 'SOURCES.md', 'glossary.csv']);
const OVERLAY_EXTENSION = '.json';
const MAP_FILE = /^[0-9a-f]{64}$/;
/** The campaign id spelling the campaign index accepts. */
const CAMPAIGN_FILE = /^[a-z0-9][a-z0-9_-]*$/;

/** Why a file of one kind is misnamed, or undefined when its id is valid. */
function misnamed(kind: OverlayKind, id: string): string | undefined {
  switch (kind) {
    case 'maps':
      return MAP_FILE.test(id) ? undefined : 'a map overlay is named by the SHA-256 hex of its map.dat';
    case 'objects':
      return isGameObjectTable(id) ? undefined : `an object table is one of ${GAME_OBJECT_TABLES.join(', ')}`;
    case 'books':
      return id === HISTORY_BOOK ? undefined : `the only book is ${HISTORY_BOOK}`;
    case 'campaigns':
      return CAMPAIGN_FILE.test(id) ? undefined : 'a campaign overlay is named by the campaign id';
  }
}

const isOverlayKind = (name: string): name is OverlayKind =>
  (OVERLAY_KINDS as readonly string[]).includes(name);
/** Dot files are the file system's, not the layout's. */
const isHidden = (name: string): boolean => name.startsWith('.');

/** Every overlay file that passed its schema and layout, by kind. */
interface ValidOverlays {
  readonly maps: {
    readonly file: string;
    readonly lang: Language;
    readonly digest: string;
    readonly overlay: MapOverlay;
  }[];
  readonly objects: {
    readonly file: string;
    readonly table: GameObjectTable;
    readonly overlay: ObjectTableOverlay;
  }[];
  readonly books: { readonly file: string; readonly overlay: BookOverlay }[];
  readonly campaigns: { readonly file: string; readonly id: string }[];
}

/** Walks `root`, reporting layout and schema violations and collecting the valid overlays. */
async function readLayout(root: string, errors: AuditFinding[]): Promise<ValidOverlays> {
  const valid: ValidOverlays = { maps: [], objects: [], books: [], campaigns: [] };
  for (const top of await listDirectory(root)) {
    if (isHidden(top.name)) continue;
    if (!top.isDirectory()) {
      if (!ROOT_FILES.has(top.name))
        errors.push({ file: top.name, message: 'not part of the translations layout' });
      continue;
    }
    const lang = top.name;
    if (!isLanguage(lang)) {
      errors.push({ file: `${lang}/`, message: 'not a language code of the registry' });
      continue;
    }
    for (const kindEntry of await listDirectory(join(root, lang))) {
      if (isHidden(kindEntry.name)) continue;
      const kind = kindEntry.name;
      if (!kindEntry.isDirectory() || !isOverlayKind(kind)) {
        errors.push({
          file: `${lang}/${kind}`,
          message: `expected one of the folders ${OVERLAY_KINDS.join(', ')}`,
        });
        continue;
      }
      for (const entry of await listDirectory(join(root, lang, kind))) {
        if (isHidden(entry.name)) continue;
        const file = `${lang}/${kind}/${entry.name}`;
        if (!entry.isFile() || !entry.name.endsWith(OVERLAY_EXTENSION)) {
          errors.push({ file, message: 'an overlay is a .json file' });
          continue;
        }
        const id = entry.name.slice(0, -OVERLAY_EXTENSION.length);
        const wrongName = misnamed(kind, id);
        if (wrongName !== undefined) {
          errors.push({ file, message: wrongName });
          continue;
        }
        if (isSourceLanguage(lang) && kind !== 'maps') {
          errors.push({
            file,
            message: 'a source language overlays only community maps; its own text keeps corrections',
          });
          continue;
        }
        const path = join(root, lang, kind, entry.name);
        try {
          switch (kind) {
            case 'maps':
              valid.maps.push({ file, lang, digest: id, overlay: await readOverlayFile('maps', path) });
              break;
            case 'objects':
              if (isGameObjectTable(id))
                valid.objects.push({ file, table: id, overlay: await readOverlayFile('objects', path) });
              break;
            case 'books':
              valid.books.push({ file, overlay: await readOverlayFile('books', path) });
              break;
            case 'campaigns':
              await readOverlayFile('campaigns', path);
              valid.campaigns.push({ file, id });
              break;
          }
        } catch (err) {
          errors.push({
            file,
            message: (err instanceof Error ? err.message : String(err)).replace(`${path}: `, ''),
          });
        }
      }
    }
  }
  return valid;
}

/** The keys of `overlay` that `source` lacks, listed for a warning, or undefined when it has them all. */
function missingKeys(
  overlay: Readonly<Record<string, string>>,
  source: (key: string) => boolean,
): string | undefined {
  const missing = Object.keys(overlay).filter((key) => !source(key));
  return missing.length === 0 ? undefined : missing.join(', ');
}

/** The warnings of one map overlay against every pack copy of its map. */
function auditMapOverlay(
  { file, lang, overlay }: ValidOverlays['maps'][number],
  copies: readonly PackMap[],
  warn: (file: string, message: string) => void,
): void {
  for (const map of copies) {
    const where = map.campaign === undefined ? map.folder : `campaign map ${map.folder}`;
    if (isSourceLanguage(lang) && !map.takesSourceLanguages) {
      warn(file, `${where} takes no source-language overlay; the pipeline refuses it`);
      continue;
    }
    if (lang !== overlay.basis.lang && map.text.languages[lang] !== undefined) {
      warn(file, `${where} ships ${lang} text itself, which wins; the overlay is redundant`);
      continue;
    }
    const basis = map.text.languages[overlay.basis.lang];
    const digest = mapSourceTextDigest(basis?.strings ?? {}, basis?.briefings ?? new Map());
    if (digest !== overlay.basis.digest) warn(file, `${where}: the ${overlay.basis.lang} basis text changed`);
    const ids = missingKeys(overlay.strings, (id) => basis?.strings[Number(id)] !== undefined);
    if (ids !== undefined) warn(file, `${where}: string ids the ${overlay.basis.lang} source lacks: ${ids}`);
    const labels = missingKeys(overlay.briefings, (label) => basis?.briefings.has(label) === true);
    if (labels !== undefined)
      warn(file, `${where}: briefing labels the ${overlay.basis.lang} source lacks: ${labels}`);
  }
}

/**
 * Validates every overlay under `root` against its schema and the layout, and with `pack` checks each
 * against the source text it was written for. Only schema and layout violations are errors.
 */
export async function auditTranslations(root: string, pack?: PackText): Promise<AuditReport> {
  const errors: AuditFinding[] = [];
  const warnings: AuditFinding[] = [];
  const warn = (file: string, message: string): void => {
    warnings.push({ file, message });
  };
  const valid = await readLayout(root, errors);
  const files = valid.maps.length + valid.objects.length + valid.books.length + valid.campaigns.length;
  let unmatchedMaps = 0;
  if (pack !== undefined) {
    const maps = valid.maps.length === 0 ? new Map<string, readonly PackMap[]>() : await pack.maps();
    for (const entry of valid.maps) {
      const copies = maps.get(entry.digest);
      if (copies === undefined) unmatchedMaps++;
      else auditMapOverlay(entry, copies, warn);
    }
    for (const { file, table, overlay } of valid.objects) {
      let source: GameObjectNames;
      try {
        source = await pack.objectNames(overlay.basis.lang, table);
      } catch (err) {
        warn(
          file,
          `no readable ${overlay.basis.lang} ${table} table: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (objectTableSourceDigest(source) !== overlay.basis.digest)
        warn(file, `the ${overlay.basis.lang} basis text changed`);
      const ids = missingKeys(overlay.names, (id) => source.names[Number(id)] !== undefined);
      if (ids !== undefined) warn(file, `type ids the ${overlay.basis.lang} source lacks: ${ids}`);
    }
    for (const { file, overlay } of valid.books) {
      const source = await pack.historyBlocks(overlay.basis.lang);
      if (source === undefined) {
        warn(file, `the pack has no ${overlay.basis.lang} history book`);
        continue;
      }
      if (bookSourceDigest(source) !== overlay.basis.digest)
        warn(file, `the ${overlay.basis.lang} basis text changed`);
      for (const [blockFile, labels] of Object.entries(overlay.blocks)) {
        const missing = missingKeys(labels, (label) => source.get(blockFile)?.has(label) === true);
        if (missing !== undefined)
          warn(file, `${blockFile} labels the ${overlay.basis.lang} source lacks: ${missing}`);
      }
    }
    for (const { file, id } of valid.campaigns) {
      if (!pack.campaigns.has(id)) warn(file, `the pack has no campaign ${id}`);
    }
  }
  const byFile = (a: AuditFinding, b: AuditFinding): number =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  return { files, errors: errors.sort(byFile), warnings: warnings.sort(byFile), unmatchedMaps };
}

/** The repository checkout this tool belongs to. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UNPACKED_PACK = ['.cache', 'data', 'unpacked'] as const;

/** The primary checkout of a Git worktree, which keeps the unpacked pack a worktree lacks. */
function primaryCheckout(): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return dirname(common);
  } catch {
    return undefined;
  }
}

/** `ON_DATA_ROOT`, else the first checkout, this one then the primary, that holds the unpacked pack. */
function packRoot(): { readonly root: string | undefined; readonly looked: readonly string[] } {
  // INIT_CWD is where `npm run` was invoked; a relative ON_DATA_ROOT means that directory.
  const explicit = process.env.ON_DATA_ROOT;
  const looked =
    explicit === undefined
      ? [REPO_ROOT, primaryCheckout()].flatMap((checkout) =>
          checkout === undefined ? [] : [join(checkout, ...UNPACKED_PACK)],
        )
      : [resolve(process.env.INIT_CWD ?? process.cwd(), explicit)];
  return { root: looked.find((dir) => existsSync(join(dir, 'manifest.json'))), looked };
}

async function main(): Promise<void> {
  const { root: dataRoot, looked } = packRoot();
  const pack = dataRoot === undefined ? undefined : await readPackText(dataRoot);
  const report = await auditTranslations(TRANSLATIONS_ROOT, pack);
  for (const { file, message } of report.errors) console.error(`error   translations/${file}: ${message}`);
  for (const { file, message } of report.warnings) console.warn(`warning translations/${file}: ${message}`);
  const scope =
    dataRoot === undefined
      ? `schema and layout only: no unpacked pack at ${looked.join(' or ')} (ON_DATA_ROOT)`
      : `checked against ${dataRoot}; ${report.unmatchedMaps} map overlay(s) name no map of the pack`;
  console.log(
    `check:translations - ${report.files} overlay file(s), ${report.errors.length} error(s), ` +
      `${report.warnings.length} warning(s); ${scope}`,
  );
  if (report.errors.length > 0) process.exitCode = 1;
}

// Runs only as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error('check:translations failed:', err);
    process.exitCode = 1;
  });
}
