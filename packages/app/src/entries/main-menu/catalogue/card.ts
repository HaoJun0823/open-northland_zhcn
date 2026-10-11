import type { CatalogEntry, MapTextLanguage } from '@open-northland/data';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { listedIn, mapItem } from '../map-select-model.js';
import { type CatalogueRow, canDownload } from './model.js';

/** What the cards, the detail panel and the Installed tab ask of the view that owns the data. */
export interface CatalogueContext {
  /** `play` opens the lobby from the main menu; `choose` picks the map for a multiplayer room. */
  readonly purpose: 'play' | 'choose';
  /** False where the platform has no installed-map store: nothing downloads or removes. */
  readonly canStore: boolean;
  thumbnail(entry: CatalogEntry): string | null;
  /** Download progress as a fraction while the entry downloads. */
  progress(entryId: string): number | undefined;
  /** The last download or removal error, shown until the next attempt. */
  failure(entryId: string): string | undefined;
  download(row: CatalogueRow): void;
  remove(entryId: string): void;
  pick(row: CatalogueRow): void;
  open(entryId: string): void;
}

const PERCENT = 100;

/** Short language codes as chips list them. */
const LANGUAGE_CODES: Readonly<Record<MapTextLanguage, string>> = {
  pol: 'PL',
  eng: 'EN',
  ger: 'DE',
  rus: 'RU',
};

export function languageCodes(languages: readonly MapTextLanguage[]): string {
  return languages.map((language) => LANGUAGE_CODES[language]).join(' ');
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(bcp47Tag(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatCount(count: number, compact = false): string {
  return new Intl.NumberFormat(bcp47Tag(), compact ? { notation: 'compact' } : {}).format(count);
}

/** "4 players", or "2-8 players" for a pack whose maps differ; null when no map lists seats. */
export function playersText(counts: readonly number[]): string | null {
  const min = counts[0];
  const max = counts.at(-1);
  if (min === undefined || max === undefined) return null;
  if (min !== max) return formatMessage(messages().mapCatalogue.playersRange, { min, max });
  return formatMessage(pluralForm(max, messages().mainMenu.mapSelect.players, bcp47Tag()), { count: max });
}

/** The kind as a card names it; an entry the keywords did not place shows its catalogue category. */
export function kindText(entry: CatalogEntry): string {
  return entry.kind === 'other' ? entry.categoryLabel : messages().mapCatalogue.kindChips[entry.kind];
}

export function chips(row: CatalogueRow): HTMLElement {
  const text = messages().mapCatalogue;
  const players = playersText(row.playerCounts);
  const parts = [
    kindText(row.entry),
    ...(row.entry.series ? [text.seriesChip] : []),
    ...(players === null ? [] : [players]),
    ...(row.languages.length > 0 ? [languageCodes(row.languages)] : []),
  ].filter((part) => part !== '');
  const box = node('div', 'catalogue-chips');
  box.append(...parts.map((part) => node('span', 'catalogue-chip', part)));
  return box;
}

/** Whether a multiplayer room can take the installed map: listed for multiplayer, with a free seat. */
export function roomCanTake(row: CatalogueRow): boolean {
  const index = row.playableIndex;
  return index !== null && listedIn(mapItem(index), 'multiplayer') && hasClaimableSeat(index.players ?? []);
}

function button(className: string, label: string, action: () => void): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', (event) => {
    // A card opens its details on a click; its own buttons do only what they say.
    event.stopPropagation();
    action();
  });
  return element;
}

/** A link that opens in a new tab, or in the system browser on the desktop. */
export function pageLink(className: string, label: string, href: string): HTMLAnchorElement {
  const link = node('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', (event) => event.stopPropagation());
  return link;
}

export function downloadLabel(row: CatalogueRow, ctx: CatalogueContext): string {
  const text = messages().mapCatalogue;
  const progress = ctx.progress(row.entry.id);
  if (progress !== undefined)
    return formatMessage(text.downloading, { percent: Math.round(progress * PERCENT) });
  return row.status === 'updatable'
    ? text.update
    : row.status === 'redownload'
      ? text.redownload
      : text.download;
}

/** Play or Choose for a playable entry; disabled in a room for a map without a free seat. */
export function pickButton(row: CatalogueRow, ctx: CatalogueContext, className: string): HTMLButtonElement {
  const text = messages().mapCatalogue;
  const pick = button(className, ctx.purpose === 'choose' ? text.choose : text.play, () => ctx.pick(row));
  if (ctx.purpose === 'choose' && !roomCanTake(row)) {
    pick.disabled = true;
    pick.title = text.notMultiplayer;
  }
  return pick;
}

export function downloadButton(
  row: CatalogueRow,
  ctx: CatalogueContext,
  className: string,
): HTMLButtonElement {
  const download = button(className, downloadLabel(row, ctx), () => ctx.download(row));
  download.disabled = ctx.progress(row.entry.id) !== undefined;
  return download;
}

export function removeButton(entryId: string, ctx: CatalogueContext): HTMLButtonElement {
  const remove = button('main-menu__ghost', messages().mapCatalogue.remove, () => ctx.remove(entryId));
  remove.disabled = ctx.progress(entryId) !== undefined;
  return remove;
}

/** The one thing a card offers: play or choose, download, or the page on another site. */
export function mainAction(row: CatalogueRow, ctx: CatalogueContext): HTMLElement | null {
  if (ctx.progress(row.entry.id) !== undefined) return downloadButton(row, ctx, 'main-menu__ghost is-accent');
  if (row.playableMapId !== null) return pickButton(row, ctx, 'main-menu__primary');
  if (canDownload(row.status) && ctx.canStore) return downloadButton(row, ctx, 'main-menu__ghost is-accent');
  if (row.entry.file.kind === 'external')
    return pageLink('main-menu__ghost', messages().mapCatalogue.openPage, row.entry.file.url);
  return null;
}

export function thumbImage(url: string | null): HTMLImageElement | null {
  if (url === null) return null;
  const img = node('img');
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  // A missing screenshot leaves the frame's gradient instead of a broken-image glyph.
  img.addEventListener('error', () => img.remove());
  return img;
}

/** A state worth a badge; a plain downloadable entry carries none. */
export function badge(row: CatalogueRow): HTMLElement | null {
  if (row.status === 'available') return null;
  return node('span', `catalogue-badge is-${row.status}`, messages().mapCatalogue.badges[row.status]);
}

/** Which date a card shows: the update date while the grid sorts by it, else the publication. */
export type CardDate = 'published' | 'updated';

/** One grid card: picture, title, author, chips, numbers and the main action. */
export function catalogueCard(row: CatalogueRow, ctx: CatalogueContext, dateOf: CardDate) {
  const text = messages().mapCatalogue;
  const { entry } = row;
  const card = node('article', 'catalogue-card');
  card.dataset.entryId = entry.id;
  card.tabIndex = 0;
  card.setAttribute('aria-label', entry.title);
  const picture = node('div', 'catalogue-card__picture');
  const img = thumbImage(ctx.thumbnail(entry));
  if (img !== null) picture.append(img);
  const state = badge(row);
  if (state !== null) picture.append(state);
  const body = node('div', 'catalogue-card__body');
  const title = node('div', 'catalogue-card__title', entry.title);
  title.title = entry.title;
  const author = node(
    'div',
    'catalogue-card__author',
    formatMessage(text.byAuthor, { author: entry.author }),
  );
  const foot = node('div', 'catalogue-card__foot');
  const stats = node('div', 'catalogue-card__stats');
  const likes = node('span', 'catalogue-stat is-likes', formatCount(entry.likeCount, true));
  likes.title = text.details.likes;
  const downloads = node('span', 'catalogue-stat is-downloads', formatCount(entry.downloadCount, true));
  downloads.title = text.details.downloads;
  const date = node(
    'span',
    'catalogue-stat',
    formatDate(dateOf === 'updated' ? entry.updatedAt : entry.publishedAt),
  );
  date.title = dateOf === 'updated' ? text.details.updated : text.details.published;
  stats.append(likes, downloads, date);
  const action = node('div', 'catalogue-card__action');
  const paintAction = (next: CatalogueRow): void => {
    const element = mainAction(next, ctx);
    action.replaceChildren(...(element === null ? [] : [element]));
  };
  paintAction(row);
  foot.append(stats, action);
  body.append(title, author, chips(row), foot);
  card.append(picture, body);
  card.addEventListener('click', () => ctx.open(entry.id));
  card.addEventListener('keydown', (event) => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    ctx.open(entry.id);
  });
  return { element: card, paintAction };
}
