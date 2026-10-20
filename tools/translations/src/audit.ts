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
  parseMapOverlayFileId,
  type SourceLanguage,
  splitOverlayEdit,
} from '@open-northland/data';
import { type MapLanguageText, mapSourceTextDigest, selectMapOverlay } from '@open-northland/map-import';
import {
  listDirectory,
  MAP_OVERLAY_NAMING,
  MapOverlayFiling,
  OVERLAY_KINDS,
  type OverlayKind,
  readOverlayFile,
  TRANSLATIONS_ROOT,
} from '@open-northland/translations';
import { blockMarkupDiffers, stringMarkupDiffers } from './markup.js';
import {
  bookSourceDigest,
  objectTableSourceDigest,
  type PackMap,
  type PackText,
  readPackText,
} from './pack-text.js';

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
  /** Overlays the pipeline leaves out or reads against changed source text, and values still the
   *  source text unchanged. */
  readonly warnings: readonly AuditFinding[];
  /** Map overlays no map of the pack takes: filed under a `map.dat` key no map of the pack has, or an edit or
   *  one of several of a language whose basis no copy's text matches. A catalogue map's, or a stale
   *  identity. */
  readonly unmatchedMaps: number;
}

/** The files the contract keeps at the translations root beside the language folders. */
const ROOT_FILES: ReadonlySet<string> = new Set([
  'AGENTS.md',
  'SOURCES.md',
  'glossary.csv',
  'glossary-project.csv',
]);
const OVERLAY_EXTENSION = '.json';
/** The campaign id spelling the campaign index accepts. */
const CAMPAIGN_FILE = /^[a-z0-9][a-z0-9_-]*$/;

/** Why a file of one kind is misnamed, or undefined when its id is valid; a map or object table edit
 *  (`<name>.edit`) is named by the overlay it edits. */
function misnamed(kind: OverlayKind, id: string): string | undefined {
  const { name } = splitOverlayEdit(id);
  switch (kind) {
    case 'maps':
      return parseMapOverlayFileId(name) === undefined ? MAP_OVERLAY_NAMING : undefined;
    case 'objects':
      return isGameObjectTable(name)
        ? undefined
        : `an object table is one of ${GAME_OBJECT_TABLES.join(', ')}`;
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

/** One map overlay file that passed its schema and layout. */
interface MapOverlayFile {
  readonly file: string;
  readonly lang: Language;
  /** The `map.dat` key the file name carries. */
  readonly datKey: string;
  readonly overlay: MapOverlay;
}

/** One object table overlay file that passed its schema and layout. */
interface ObjectTableOverlayFile {
  readonly file: string;
  readonly lang: Language;
  readonly table: GameObjectTable;
  readonly overlay: ObjectTableOverlay;
}

/** Every overlay file that passed its schema and layout, by kind; the project's edits over imported
 *  overlays apart from the overlays they edit. */
interface ValidOverlays {
  readonly maps: MapOverlayFile[];
  readonly mapEdits: MapOverlayFile[];
  readonly objects: ObjectTableOverlayFile[];
  readonly objectEdits: ObjectTableOverlayFile[];
  readonly books: { readonly file: string; readonly overlay: BookOverlay }[];
  readonly campaigns: { readonly file: string; readonly id: string }[];
}

/** Walks `root`, reporting layout and schema violations and collecting the valid overlays. */
async function readLayout(root: string, errors: AuditFinding[]): Promise<ValidOverlays> {
  const valid: ValidOverlays = {
    maps: [],
    mapEdits: [],
    objects: [],
    objectEdits: [],
    books: [],
    campaigns: [],
  };
  const filing = new MapOverlayFiling();
  /** Map edits attach after every overlay is filed, since `.edit.json` sorts before `.json`. */
  const mapEdits: {
    readonly file: string;
    readonly lang: Language;
    readonly name: string;
    readonly overlay: MapOverlay;
  }[] = [];
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
            case 'maps': {
              const overlay = await readOverlayFile('maps', path);
              const { name, edit } = splitOverlayEdit(id);
              if (edit) {
                mapEdits.push({ file, lang, name, overlay });
                break;
              }
              const refusal = filing.file(lang, name, overlay);
              const datKey = parseMapOverlayFileId(name)?.datKey;
              if (refusal !== undefined) errors.push({ file, message: refusal });
              else if (datKey !== undefined) valid.maps.push({ file, lang, datKey, overlay });
              break;
            }
            case 'objects': {
              const { name, edit } = splitOverlayEdit(id);
              if (isGameObjectTable(name)) {
                const overlay = await readOverlayFile('objects', path);
                (edit ? valid.objectEdits : valid.objects).push({ file, lang, table: name, overlay });
              }
              break;
            }
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
  for (const { file, lang, name, overlay } of mapEdits) {
    const refusal = filing.edit(lang, name, overlay);
    const datKey = parseMapOverlayFileId(name)?.datKey;
    if (refusal !== undefined) errors.push({ file, message: refusal });
    else if (datKey !== undefined) valid.mapEdits.push({ file, lang, datKey, overlay });
  }
  for (const edit of valid.objectEdits) {
    const edited = valid.objects.some((table) => table.lang === edit.lang && table.table === edit.table);
    if (!edited)
      errors.push({
        file: edit.file,
        message: `an edit needs the overlay it edits beside it, ${edit.table}.json`,
      });
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

const MARKUP_TAG = /<[^>]*>/g;
const LETTER = /\p{L}/u;

/** Whether a value has a letter outside its tags; one without, such as `...` or a lone picture, reads
 *  the same in every language. */
const hasWords = (text: string): boolean => LETTER.test(text.replace(MARKUP_TAG, ''));

/** How many values of `overlay` have words, and the string ids and briefing labels of those that are
 *  still the basis text unchanged. */
function unchangedKeys(
  overlay: MapOverlay,
  basis: MapLanguageText | undefined,
): { readonly worded: number; readonly ids: readonly string[]; readonly labels: readonly string[] } {
  const worded = (entries: Readonly<Record<string, string>>) =>
    Object.entries(entries).filter(([, text]) => hasWords(text));
  const strings = worded(overlay.strings);
  const blocks = worded(overlay.briefings);
  return {
    worded: strings.length + blocks.length,
    ids: strings.filter(([id, text]) => basis?.strings[Number(id)] === text).map(([id]) => id),
    labels: blocks.filter(([label, text]) => basis?.briefings.get(label) === text).map(([label]) => label),
  };
}

/** The string ids and briefing labels of `overlay` that do not keep the markup of their basis text. */
function markupChanges(
  overlay: MapOverlay,
  basis: MapLanguageText | undefined,
): { readonly ids: readonly string[]; readonly labels: readonly string[] } {
  const ids = Object.entries(overlay.strings).filter(([id, text]) => {
    const source = basis?.strings[Number(id)];
    return source !== undefined && stringMarkupDiffers(source, text);
  });
  const labels = Object.entries(overlay.briefings).filter(([label, text]) => {
    const source = basis?.briefings.get(label);
    return source !== undefined && blockMarkupDiffers(source, text);
  });
  return { ids: ids.map(([id]) => id), labels: labels.map(([label]) => label) };
}

/** Where a warning names a pack map. */
const whereOf = (map: PackMap): string =>
  map.campaign === undefined ? map.folder : `campaign map ${map.folder}`;

/** The basis digest of `map`'s text in `lang`, none when it ships no such text. */
function textDigest(map: PackMap, lang: SourceLanguage): string {
  const text = map.text.languages[lang];
  return mapSourceTextDigest(text?.strings ?? {}, text?.briefings ?? new Map());
}

/** The warnings of one overlay, which the pipeline applies to `map`, one of `copies` of its map.dat;
 *  `stale` when it was written against other text than the map's. */
function auditAppliedOverlay(
  { file, lang, overlay }: MapOverlayFile,
  map: PackMap,
  copies: readonly PackMap[],
  stale: boolean,
  warn: (file: string, message: string) => void,
): void {
  const where = whereOf(map);
  const basis = map.text.languages[overlay.basis.lang];
  if (stale) {
    const twin = copies.find((other) => textDigest(other, overlay.basis.lang) === overlay.basis.digest);
    warn(
      file,
      twin === undefined
        ? `${where}: the ${overlay.basis.lang} basis text changed`
        : `${where}: its ${overlay.basis.lang} text differs from ${whereOf(twin)}'s, which the overlay ` +
            'was written against; a variant file gives it its own',
    );
  }
  const ids = missingKeys(overlay.strings, (id) => basis?.strings[Number(id)] !== undefined);
  if (ids !== undefined) warn(file, `${where}: string ids the ${overlay.basis.lang} source lacks: ${ids}`);
  const labels = missingKeys(overlay.briefings, (label) => basis?.briefings.has(label) === true);
  if (labels !== undefined)
    warn(file, `${where}: briefing labels the ${overlay.basis.lang} source lacks: ${labels}`);
  const remarked = markupChanges(overlay, basis);
  if (remarked.ids.length > 0)
    warn(
      file,
      `${where}: string ids whose goal prefix or placeholders differ from the ${overlay.basis.lang} ` +
        `source: ${remarked.ids.join(', ')}`,
    );
  if (remarked.labels.length > 0)
    warn(
      file,
      `${where}: briefing labels whose tags differ from the ${overlay.basis.lang} source: ` +
        remarked.labels.join(', '),
    );
  // An overlay in its basis language edits that text rather than translating it.
  const kept = lang === overlay.basis.lang ? 'unedited' : 'untranslated';
  const source = `the ${overlay.basis.lang} source text`;
  const unchanged = unchangedKeys(overlay, basis);
  if (unchanged.worded > 0 && unchanged.ids.length + unchanged.labels.length === unchanged.worded) {
    warn(file, `${where}: ${kept}, every value is still ${source}`);
  } else {
    if (unchanged.ids.length > 0)
      warn(file, `${where}: ${kept} string ids, still ${source}: ${unchanged.ids.join(', ')}`);
    if (unchanged.labels.length > 0)
      warn(file, `${where}: ${kept} briefing labels, still ${source}: ${unchanged.labels.join(', ')}`);
  }
}

/**
 * The warnings of one language's overlays of a `map.dat` against every pack copy of the map, each copy
 * taking the overlay the pipeline selects for it. Answers how many of the files no copy takes.
 */
function auditMapOverlays(
  files: readonly MapOverlayFile[],
  copies: readonly PackMap[],
  warn: (file: string, message: string) => void,
): number {
  const [first] = files;
  if (first === undefined) return 0;
  const { lang } = first;
  // An edit, the one overlay of its language in that language, applies only to the text it was written
  // against; it has no stale fallback.
  const edit = files.length === 1 && first.overlay.basis.lang === lang ? first.overlay : undefined;
  for (const map of copies) {
    const where = whereOf(map);
    if (isSourceLanguage(lang) && !map.takesSourceLanguages) {
      for (const { file } of files)
        warn(file, `${where} takes no source-language overlay; the pipeline refuses it`);
      continue;
    }
    const selected = selectMapOverlay(
      lang,
      files.map(({ overlay }) => overlay),
      (basisLang) => textDigest(map, basisLang),
    );
    const applied = files.find(({ overlay }) => overlay === selected?.overlay);
    if (selected === undefined && edit !== undefined) {
      const twin = copies.find((other) => textDigest(other, edit.basis.lang) === edit.basis.digest);
      warn(
        first.file,
        twin === undefined
          ? `${where}: not applied, its ${lang} basis text differs from the one the edit was written against`
          : `${where}: not applied, its ${lang} text differs from ${whereOf(twin)}'s, which the edit was ` +
              'written against',
      );
      continue;
    }
    if (selected === undefined || applied === undefined) {
      warn(
        first.file,
        `${where} takes none of the ${files.length} ${lang} overlays of its map.dat: its text matches the ` +
          `basis of none of ${files.map(({ file }) => file).join(', ')}`,
      );
      continue;
    }
    const { overlay } = applied;
    if (lang !== overlay.basis.lang && map.text.languages[lang] !== undefined) {
      warn(applied.file, `${where} ships ${lang} text itself, which wins; the overlay is redundant`);
      continue;
    }
    auditAppliedOverlay(applied, map, copies, selected.stale, warn);
  }
  const taken = (overlay: MapOverlay) =>
    (files.length === 1 && edit === undefined) ||
    copies.some((map) => textDigest(map, overlay.basis.lang) === overlay.basis.digest);
  return files.filter(({ overlay }) => !taken(overlay)).length;
}

/**
 * The warnings of one project edit over an imported overlay: it applies to each copy of its `map.dat`
 * whose text in its basis language it was written against, and should cover every key of the project's
 * edit of that text (`overlays`, same `map.dat` and basis). Returns 1 when no copy of the pack takes it.
 */
function auditMapEdit(
  edit: MapOverlayFile,
  overlays: readonly MapOverlayFile[],
  maps: ReadonlyMap<string, readonly PackMap[]>,
  warn: (file: string, message: string) => void,
): number {
  const { file, overlay } = edit;
  const copies = maps.get(edit.datKey);
  if (copies === undefined) return 1;
  const matching = copies.filter((map) => textDigest(map, overlay.basis.lang) === overlay.basis.digest);
  if (matching.length === 0) {
    warn(file, `the ${overlay.basis.lang} basis text changed; the edit is left out`);
    return 1;
  }
  for (const map of matching) auditAppliedOverlay(edit, map, copies, false, warn);
  const source = overlays.find(
    (other) =>
      other.lang === overlay.basis.lang &&
      other.datKey === edit.datKey &&
      other.overlay.basis.digest === overlay.basis.digest,
  );
  if (source !== undefined) {
    const ids = missingKeys(source.overlay.strings, (id) => overlay.strings[id] !== undefined);
    const labels = missingKeys(source.overlay.briefings, (label) => overlay.briefings[label] !== undefined);
    if (ids !== undefined) warn(file, `does not cover string ids ${source.file} edits: ${ids}`);
    if (labels !== undefined) warn(file, `does not cover briefing labels ${source.file} edits: ${labels}`);
  }
  return 0;
}

/** The valid map overlays by `map.dat` key, then language, in file order. */
function mapOverlaysByDatKey(maps: readonly MapOverlayFile[]): Map<string, Map<Language, MapOverlayFile[]>> {
  const byKey = new Map<string, Map<Language, MapOverlayFile[]>>();
  for (const entry of maps) {
    const byLanguage = byKey.get(entry.datKey) ?? new Map<Language, MapOverlayFile[]>();
    byLanguage.set(entry.lang, [...(byLanguage.get(entry.lang) ?? []), entry]);
    byKey.set(entry.datKey, byLanguage);
  }
  return byKey;
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
  const files =
    valid.maps.length +
    valid.mapEdits.length +
    valid.objects.length +
    valid.objectEdits.length +
    valid.books.length +
    valid.campaigns.length;
  let unmatchedMaps = 0;
  if (pack !== undefined) {
    const maps = valid.maps.length === 0 ? new Map<string, readonly PackMap[]>() : await pack.maps();
    for (const [datKey, byLanguage] of mapOverlaysByDatKey(valid.maps)) {
      const copies = maps.get(datKey);
      for (const files of byLanguage.values())
        unmatchedMaps += copies === undefined ? files.length : auditMapOverlays(files, copies, warn);
    }
    for (const edit of valid.mapEdits) unmatchedMaps += auditMapEdit(edit, valid.maps, maps, warn);
    for (const { file, table, overlay } of [...valid.objects, ...valid.objectEdits]) {
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
      : `checked against ${dataRoot}; ${report.unmatchedMaps} map overlay(s) no map of the pack takes`;
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
