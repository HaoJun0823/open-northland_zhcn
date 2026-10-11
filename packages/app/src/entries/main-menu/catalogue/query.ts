import type { CatalogKind, MapTextLanguage } from '@open-northland/data';
import { type CatalogueRow, isInGame, isReady, type MapSize } from './model.js';

export type CatalogueSort = 'liked' | 'downloaded' | 'newest' | 'updated' | 'title' | 'author';
export const CATALOGUE_SORTS: readonly CatalogueSort[] = [
  'liked',
  'downloaded',
  'newest',
  'updated',
  'title',
  'author',
];

export type KindFilter = 'all' | CatalogKind;
export const KIND_FILTERS: readonly KindFilter[] = ['all', 'single', 'multi', 'campaign', 'other'];

export type StateFilter = 'all' | 'installed' | 'update' | 'notInstalled' | 'inGame' | 'inGameChanged';
export const STATE_FILTERS: readonly StateFilter[] = [
  'all',
  'installed',
  'update',
  'notInstalled',
  'inGame',
  'inGameChanged',
];

/** What the browse tab shows: the search, the sort and every filter. */
export interface CatalogueQuery {
  readonly text: string;
  readonly sort: CatalogueSort;
  readonly kind: KindFilter;
  /** Only entries the upstream files under the Cultures series. */
  readonly seriesOnly: boolean;
  /** A seat count some map of the pack offers; null for any. */
  readonly players: number | null;
  readonly language: MapTextLanguage | null;
  readonly size: MapSize | null;
  /** A part of the author's name; empty for any. */
  readonly author: string;
  readonly state: StateFilter;
  /** Only entries this build can install or play. */
  readonly readyOnly: boolean;
  /** Entries whose file lives on another site, which only open their page. */
  readonly showExternal: boolean;
}

export const DEFAULT_CATALOGUE_QUERY: CatalogueQuery = {
  text: '',
  sort: 'liked',
  kind: 'all',
  seriesOnly: false,
  players: null,
  language: null,
  size: null,
  author: '',
  state: 'all',
  readyOnly: true,
  showExternal: false,
};

/** Whether any filter differs from the default; the search and the sort are not filters. */
export function hasActiveFilters(query: CatalogueQuery): boolean {
  const { text: _text, sort: _sort, ...filters } = query;
  const { text: _defaultText, sort: _defaultSort, ...defaults } = DEFAULT_CATALOGUE_QUERY;
  return (Object.keys(filters) as (keyof typeof filters)[]).some((key) => filters[key] !== defaults[key]);
}

/** Lower case without diacritics, so "zolw" finds "Żółw". `ł` has no decomposition of its own. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase();
}

function matchesText(row: CatalogueRow, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const { title, author, shortDescription, fullDescription } = row.entry;
  const haystack = foldText(`${title}\n${author}\n${shortDescription}\n${fullDescription}`);
  return words.every((word) => haystack.includes(word));
}

function matchesState(row: CatalogueRow, state: StateFilter): boolean {
  switch (state) {
    case 'all':
      return true;
    case 'installed':
      return row.playableMapId !== null && !isInGame(row.status);
    case 'update':
      return row.status === 'updatable' || row.status === 'redownload';
    case 'notInstalled':
      return row.playableMapId === null && row.status !== 'redownload' && !isInGame(row.status);
    case 'inGame':
    case 'inGameChanged':
      return row.status === state;
  }
}

export function matchesQuery(row: CatalogueRow, query: CatalogueQuery): boolean {
  const { entry } = row;
  const author = foldText(query.author.trim());
  return (
    // A link is never ready to play; its own switch decides whether it shows.
    (entry.file.kind === 'external' ? query.showExternal : !query.readyOnly || isReady(row)) &&
    (query.kind === 'all' || entry.kind === query.kind) &&
    (!query.seriesOnly || entry.series) &&
    (query.players === null || row.playerCounts.includes(query.players)) &&
    (query.language === null || row.languages.includes(query.language)) &&
    (query.size === null || row.size === query.size) &&
    (author === '' || foldText(entry.author).includes(author)) &&
    matchesState(row, query.state) &&
    matchesText(row, foldText(query.text).split(/\s+/).filter(Boolean))
  );
}

type Compare = (a: string, b: string) => number;

const byTime = (a: string, b: string): number => Date.parse(b) - Date.parse(a);

function comparator(sort: CatalogueSort, compareLabels: Compare) {
  const byTitle = (a: CatalogueRow, b: CatalogueRow): number =>
    compareLabels(a.entry.title, b.entry.title) || (a.entry.id < b.entry.id ? -1 : 1);
  switch (sort) {
    case 'liked':
      return (a: CatalogueRow, b: CatalogueRow) =>
        b.entry.likeCount - a.entry.likeCount ||
        b.entry.downloadCount - a.entry.downloadCount ||
        byTitle(a, b);
    case 'downloaded':
      return (a: CatalogueRow, b: CatalogueRow) =>
        b.entry.downloadCount - a.entry.downloadCount ||
        b.entry.likeCount - a.entry.likeCount ||
        byTitle(a, b);
    case 'newest':
      return (a: CatalogueRow, b: CatalogueRow) =>
        byTime(a.entry.publishedAt, b.entry.publishedAt) || byTitle(a, b);
    case 'updated':
      return (a: CatalogueRow, b: CatalogueRow) =>
        byTime(a.entry.updatedAt, b.entry.updatedAt) || byTitle(a, b);
    case 'title':
      return byTitle;
    case 'author':
      return (a: CatalogueRow, b: CatalogueRow) =>
        compareLabels(a.entry.author, b.entry.author) || byTitle(a, b);
  }
}

/** The rows the query keeps, in its order. */
export function queryRows(
  rows: readonly CatalogueRow[],
  query: CatalogueQuery,
  compareLabels: Compare,
): readonly CatalogueRow[] {
  return rows.filter((row) => matchesQuery(row, query)).sort(comparator(query.sort, compareLabels));
}

/** The seat counts the catalogue's packs offer, for the player filter's choices. */
export function playerCountChoices(rows: readonly CatalogueRow[]): readonly number[] {
  return [...new Set(rows.flatMap((row) => row.playerCounts))].sort((a, b) => a - b);
}

/** How many author names the author field suggests at once. */
export const AUTHOR_SUGGESTION_LIMIT = 8;

/** Authors whose name holds `typed`, the most prolific first; none for an empty field or once the
 *  field names one author exactly. */
export function authorSuggestions(
  rows: readonly CatalogueRow[],
  typed: string,
  limit: number = AUTHOR_SUGGESTION_LIMIT,
): readonly string[] {
  const needle = foldText(typed.trim());
  if (needle === '') return [];
  const counts = new Map<string, number>();
  for (const { entry } of rows) {
    if (foldText(entry.author).includes(needle))
      counts.set(entry.author, (counts.get(entry.author) ?? 0) + 1);
  }
  const names = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
  return names.length === 1 && foldText(names[0] ?? '') === needle ? [] : names.slice(0, limit);
}

const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
const SIZE_FRACTION_DIGITS = 1;

/** A byte count in the largest unit that keeps it at least 1, in the locale's own unit names. */
export function formatBytes(bytes: number, localeTag: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  return new Intl.NumberFormat(localeTag, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : SIZE_FRACTION_DIGITS,
  }).format(value);
}
