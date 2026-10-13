import type { CatalogEntry } from '@open-northland/data';
import { findMapSource } from '../../../content/map-source/index.js';
import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { mapItem, mapPreviewUrl, mapSourceItem } from '../map-select-model.js';
import {
  type CatalogueContext,
  downloadButton,
  formatCount,
  formatDate,
  kindChips,
  kindText,
  languageCodes,
  manualLink,
  pageLink,
  pickButton,
  playersText,
  removeButton,
  statusLine,
} from './card.js';
import { descriptionBlocks } from './description.js';
import { type CatalogueRow, canDownload, playerCount } from './model.js';
import { formatBytes } from './query.js';

export interface CatalogueDetail {
  readonly root: HTMLElement;
  /** The entry shown, or null while the panel shows its placeholder. */
  readonly shownId: string | null;
  show(row: CatalogueRow, installed: boolean, entry?: CatalogEntry, loadError?: string): void;
  /** The placeholder art, with a line under it or none. */
  clear(line: string | null): void;
  /** Moves the focus to the main action, or to the panel's first control without one. */
  focusAction(): void;
}

function fact(list: HTMLElement, label: string, value: string): void {
  list.append(node('dt', '', label), node('dd', '', value));
}

function stripCell(label: string, value: string): HTMLElement {
  const cell = node('div', 'catalogue-detail__cell');
  cell.append(
    node('span', 'catalogue-detail__cell-label', label),
    node('span', 'catalogue-detail__cell-value', value),
  );
  return cell;
}

/** Seats as the fact strip shows them: "4", or "2-8" for a pack whose maps differ. */
function seatsText(counts: readonly number[]): string | null {
  const min = counts[0];
  const max = counts.at(-1);
  if (min === undefined || max === undefined) return null;
  return min === max ? String(min) : `${min}-${max}`;
}

/** The panel beside the grid, always there: picture, title, the facts a player decides on, the
 *  description as written, reference data, and the entry's actions in a footer that never scrolls. */
export function catalogueDetail(
  ctx: CatalogueContext,
  api: string,
  onAuthor: (author: string) => void,
): CatalogueDetail {
  const text = messages().mapCatalogue;
  const details = text.details;
  const root = node('aside', 'catalogue-detail');
  const picture = node('div', 'catalogue-detail__picture');
  const empty = node('p', 'catalogue-detail__empty');
  const scroll = node('div', 'catalogue-detail__scroll');
  const content = node('div', 'catalogue-detail__content');
  const title = node('h2', 'catalogue-detail__title');
  const byline = node('div', 'catalogue-detail__byline');
  const chipRow = node('div');
  const strip = node('div', 'catalogue-detail__strip');
  const description = node('div', 'catalogue-detail__description');
  const mapsHead = node('h3', 'catalogue-detail__heading', details.maps);
  const maps = node('ul', 'catalogue-detail__maps');
  const factsHead = node('h3', 'catalogue-detail__heading', details.more);
  const facts = node('dl', 'catalogue-detail__facts');
  content.append(title, byline, chipRow, strip, description, mapsHead, maps, factsHead, facts);
  // The picture scrolls with the text, so a short window keeps room for the description.
  scroll.append(picture, empty, content);
  const actions = node('div', 'catalogue-detail__actions');
  const status = node('p', 'catalogue-detail__status');
  status.setAttribute('role', 'status');
  const primary = node('div', 'catalogue-detail__primary');
  const links = node('div', 'catalogue-detail__links');
  actions.append(status, primary, links);
  root.append(scroll, actions);

  let shownId: string | null = null;
  let pictureLoad = 0;

  const paintPicture = (row: CatalogueRow): void => {
    const load = ++pictureLoad;
    const thumbnail = ctx.thumbnail(row.entry);
    const put = (url: string | null): void => {
      if (url === null) {
        picture.replaceChildren();
        return;
      }
      const img = node('img');
      img.alt = '';
      img.src = url;
      // A missing picture leaves the placeholder behind it.
      img.addEventListener('error', () => img.remove());
      picture.replaceChildren(img);
    };
    put(thumbnail);
    // An installed map shows its own authored picture, read from where it is installed.
    if (row.playableMapId === null) return;
    void findMapSource(row.playableMapId).then((source) => {
      if (load !== pictureLoad || source === null) return;
      const item = mapSourceItem(source, api);
      if (item.picture && item.pictureUrl !== thumbnail) put(mapPreviewUrl(item, 'picture'));
    });
  };

  const paintByline = (row: CatalogueRow): void => {
    const { entry } = row;
    const author = node('button', 'catalogue-detail__author', entry.author);
    author.type = 'button';
    author.title = formatMessage(text.byAuthor, { author: entry.author });
    author.addEventListener('click', () => onAuthor(entry.author));
    const likes = node('span', 'catalogue-stat is-likes', formatCount(entry.likeCount));
    likes.title = details.likes;
    const downloads = node('span', 'catalogue-stat is-downloads', formatCount(entry.downloadCount));
    downloads.title = details.downloads;
    byline.replaceChildren(author, likes, downloads);
  };

  const paintStrip = (row: CatalogueRow): void => {
    const main = row.maps.find((map) => map.mapId === row.mainMapId) ?? row.maps[0];
    const size =
      main === undefined || row.size === null
        ? details.unknown
        : `${text.sizes[row.size]} ${formatMessage(details.cells, main.cells)}`;
    strip.replaceChildren(
      stripCell(details.players, seatsText(row.playerCounts) ?? details.unknown),
      stripCell(details.size, size),
      stripCell(details.languages, row.languages.length > 0 ? languageCodes(row.languages) : details.unknown),
    );
  };

  const paintFacts = (row: CatalogueRow): void => {
    const { entry } = row;
    facts.replaceChildren();
    fact(facts, details.published, formatDate(entry.publishedAt));
    fact(facts, details.updated, formatDate(entry.updatedAt));
    fact(facts, details.version, entry.versionText ?? details.unknown);
    const bytes = entry.file.kind === 'external' ? undefined : entry.file.bytes;
    fact(facts, details.fileSize, bytes === undefined ? details.unknown : formatBytes(bytes, bcp47Tag()));
    fact(facts, details.category, entry.categoryLabel === '' ? kindText(entry) : entry.categoryLabel);
    if (row.shipped !== null) {
      const { index, sameVersion } = row.shipped;
      const version =
        sameVersion === null ? '' : ` (${sameVersion ? details.sameVersion : details.otherVersion})`;
      fact(facts, details.inGame, `${mapItem(index).title}${version}`);
    }
  };

  const paintMaps = (entry: CatalogEntry | undefined): void => {
    const converted = entry?.conversion?.verdict === 'ok' ? entry.conversion.maps : [];
    const many = converted.length > 1;
    mapsHead.hidden = !many;
    maps.hidden = !many;
    maps.replaceChildren(
      ...(many
        ? converted.map((map) => {
            const item = node('li');
            const players = playersText([playerCount(map.index)].filter((count) => count > 0));
            const parts = [...(players === null ? [] : [players]), formatMessage(details.cells, map.cells)];
            item.append(
              node('span', 'catalogue-detail__map-name', mapItem(map.index).title),
              node('span', 'catalogue-detail__map-meta', parts.join(' · ')),
            );
            return item;
          })
        : []),
    );
  };

  const paintActions = (row: CatalogueRow, installed: boolean, loadError?: string): void => {
    const { entry } = row;
    const failure = ctx.failure(entry.id);
    const line =
      loadError ??
      (failure === undefined ? statusLine(row) : formatMessage(text.downloadFailed, { reason: failure }));
    status.textContent = line ?? '';
    status.hidden = line === null;
    status.className = `catalogue-detail__status is-${failure === undefined ? row.status : 'error'}`;

    const progress = ctx.progress(entry.id);
    const buttons: HTMLElement[] = [];
    if (progress !== undefined) {
      buttons.push(downloadButton(row, ctx, 'main-menu__primary'));
    } else if (row.playableMapId !== null) {
      buttons.push(pickButton(row, ctx, 'main-menu__primary'));
      if (row.status === 'updatable' && ctx.canStore)
        buttons.push(downloadButton(row, ctx, 'main-menu__ghost is-accent'));
    } else if (canDownload(row.status) && ctx.canStore) {
      buttons.push(downloadButton(row, ctx, 'main-menu__primary'));
    } else {
      const manual = manualLink(row, ctx, 'main-menu__primary');
      if (manual !== null) buttons.push(manual);
    }
    const bar = node('div', 'catalogue-detail__progress');
    bar.hidden = progress === undefined;
    bar.style.setProperty('--progress', String(progress ?? 0));
    primary.replaceChildren(...buttons, bar);
    primary.hidden = buttons.length === 0;

    const page = pageLink('catalogue-detail__page', text.mapPage, entry.source.page);
    page.title = text.mapPageTitle;
    links.replaceChildren(page, ...(installed && ctx.canStore ? [removeButton(entry.id, ctx)] : []));
  };

  const setEmpty = (isEmpty: boolean): void => {
    root.classList.toggle('is-empty', isEmpty);
    empty.hidden = !isEmpty;
    content.hidden = isEmpty;
    actions.hidden = isEmpty;
  };
  setEmpty(true);

  return {
    root,
    get shownId() {
      return shownId;
    },
    show(row, installed, entry, loadError) {
      const fresh = shownId !== row.entry.id;
      shownId = row.entry.id;
      setEmpty(false);
      if (fresh) {
        paintPicture(row);
        scroll.scrollTop = 0;
      }
      title.textContent = row.entry.title;
      paintByline(row);
      chipRow.replaceChildren(kindChips(row));
      paintStrip(row);
      const about =
        row.entry.fullDescription.trim() === '' ? row.entry.shortDescription : row.entry.fullDescription;
      const blocks = descriptionBlocks(about, row.entry.title);
      description.replaceChildren(...(blocks.length > 0 ? blocks : [node('p', '', details.noDescription)]));
      description.classList.toggle('is-empty', blocks.length === 0);
      paintMaps(entry);
      paintFacts(row);
      paintActions(row, installed, loadError);
    },
    clear(line) {
      shownId = null;
      pictureLoad++;
      picture.replaceChildren();
      empty.textContent = line ?? '';
      setEmpty(true);
    },
    focusAction() {
      const target =
        primary.querySelector<HTMLElement>('button:not(:disabled), a') ?? links.querySelector('a');
      target?.focus();
    },
  };
}
