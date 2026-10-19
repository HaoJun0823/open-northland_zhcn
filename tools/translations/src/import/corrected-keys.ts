import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAME_OBJECT_TABLES } from '@open-northland/asset-pipeline/sources';
import { MAP_DAT_FILE, type MapLanguageText, mapIdFromPath } from '@open-northland/map-import';
import { listDirectory, readOverlayFile } from '@open-northland/translations';
import { BASIS_LANGUAGE } from './columns.js';

/**
 * The German text the pipeline's corrections (`tools/asset-pipeline/corrections/`) and our German map
 * overlays change. A translation of such a key still follows the uncorrected original, so the import
 * names those keys for review.
 */
export interface GermanCorrections {
  /** Object-table type ids by table. */
  readonly tables: ReadonlyMap<string, ReadonlySet<string>>;
  /** String ids by our map id. */
  readonly mapStrings: ReadonlyMap<string, ReadonlySet<string>>;
  /** Replaced `briefings.txt` lines by our map id. */
  readonly briefingLines: ReadonlyMap<string, ReadonlySet<string>>;
  /** The keys a German map overlay (`translations/ger/maps/`) replaces, by `map.dat` SHA-256. */
  readonly overlays: ReadonlyMap<string, OverlaidKeys>;
}

/** The string ids and briefing block labels one map overlay replaces. */
export interface OverlaidKeys {
  readonly strings: ReadonlySet<string>;
  readonly briefings: ReadonlySet<string>;
}

const STRING_TABLES_FILE = ['strings', 'tables.json'] as const;
const MAP_STRINGS_FILE = ['strings', 'maps.json'] as const;
/** The table key a plural correction names (`jobsPlural`), mapped onto its table. */
const PLURAL_TABLE_SUFFIX = /Plural$/;
const STRINGN_LINE = /^\s*stringn\s+(\d+)\s/;
const COMMUNITY_PREFIX = ['maps', 'community'];
const CAMPAIGN_PREFIX = 'campaigns';
const BRIEFINGS_FILE = 'briefings.txt';
const STRINGS_FILE = 'strings.ini';
const MAP_OVERLAYS_DIR = 'maps';
const OVERLAY_EXTENSION = '.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

/** Our map id for a correction's data-relative file path, when it names a map's German text. */
function correctedMap(file: string): { readonly id: string; readonly name: string } | undefined {
  const parts = file.split('/');
  const name = parts.at(-1) ?? '';
  if (!parts.includes('text') || parts[parts.indexOf('text') + 1] !== BASIS_LANGUAGE) return undefined;
  if (parts[0] === COMMUNITY_PREFIX[0] && parts[1] === COMMUNITY_PREFIX[1] && parts[2] !== undefined)
    return { id: mapIdFromPath(`${parts.slice(0, 3).join('/')}/${MAP_DAT_FILE}`), name };
  if (parts[0] === CAMPAIGN_PREFIX && parts[1] !== undefined && parts[2] !== undefined)
    return { id: `${parts[1]}-${parts[2]}`, name };
  return undefined;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readArray(path: string): Promise<unknown[]> {
  const value = await readJson(path);
  return Array.isArray(value) ? value : [];
}

/** The keys each German map overlay under the translations folder `translations` replaces. */
async function readGermanOverlays(translations: string): Promise<Map<string, OverlaidKeys>> {
  const dir = join(translations, BASIS_LANGUAGE, MAP_OVERLAYS_DIR);
  const overlays = new Map<string, OverlaidKeys>();
  for (const entry of await listDirectory(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(OVERLAY_EXTENSION)) continue;
    const overlay = await readOverlayFile('maps', join(dir, entry.name));
    overlays.set(entry.name.slice(0, -OVERLAY_EXTENSION.length), {
      strings: new Set(Object.keys(overlay.strings)),
      briefings: new Set(Object.keys(overlay.briefings)),
    });
  }
  return overlays;
}

/** Reads the German edits of the corrections folder `dir` and of the translations folder `translations`. */
export async function readGermanCorrections(dir: string, translations: string): Promise<GermanCorrections> {
  const tables = new Map<string, Set<string>>();
  const mapStrings = new Map<string, Set<string>>();
  const briefingLines = new Map<string, Set<string>>();
  const known: readonly string[] = GAME_OBJECT_TABLES;
  for (const entry of await readArray(join(dir, ...STRING_TABLES_FILE))) {
    if (!isRecord(entry) || entry.lang !== BASIS_LANGUAGE || typeof entry.table !== 'string') continue;
    const table = entry.table.replace(PLURAL_TABLE_SUFFIX, '');
    if (known.includes(table)) add(tables, table, String(entry.id));
  }
  for (const entry of await readArray(join(dir, ...MAP_STRINGS_FILE))) {
    if (isRecord(entry) && entry.lang === BASIS_LANGUAGE && typeof entry.map === 'string')
      add(mapStrings, entry.map, String(entry.id));
  }
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    const correction = await readJson(join(dir, name));
    if (!isRecord(correction) || typeof correction.file !== 'string' || !Array.isArray(correction.lines))
      continue;
    const map = correctedMap(correction.file);
    if (map === undefined) continue;
    for (const line of correction.lines) {
      if (!isRecord(line) || typeof line.from !== 'string') continue;
      if (map.name === BRIEFINGS_FILE) add(briefingLines, map.id, line.from);
      const id = map.name === STRINGS_FILE ? STRINGN_LINE.exec(line.from)?.[1] : undefined;
      if (id !== undefined) add(mapStrings, map.id, id);
    }
  }
  return { tables, mapStrings, briefingLines, overlays: await readGermanOverlays(translations) };
}

/** The keys of one map overlay whose German our corrections or German overlay change: string ids and
 *  block labels. `map` names the pack map by our id and its `map.dat` SHA-256. */
export function correctedMapKeys(
  corrections: GermanCorrections,
  map: { readonly id: string; readonly text: { readonly datDigest: string } },
  basis: { readonly text: MapLanguageText; readonly digest: string },
  overlay: {
    readonly strings: Readonly<Record<string, string>>;
    readonly briefings: Readonly<Record<string, string>>;
  },
): string[] {
  const keys: string[] = [];
  const overlaid = corrections.overlays.get(map.text.datDigest);
  const ids = new Set([...(corrections.mapStrings.get(map.id) ?? []), ...(overlaid?.strings ?? [])]);
  for (const id of ids) if (overlay.strings[id] !== undefined) keys.push(`string ${id}`);
  const lines = corrections.briefingLines.get(map.id);
  for (const label of Object.keys(overlay.briefings)) {
    const correctedLine =
      lines !== undefined &&
      (basis.text.briefings.get(label) ?? '').split('\n').some((line) => lines.has(line));
    if (correctedLine || overlaid?.briefings.has(label) === true) keys.push(`block ${label}`);
  }
  return keys;
}
