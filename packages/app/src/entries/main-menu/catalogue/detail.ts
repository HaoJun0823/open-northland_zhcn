import { findMapSource } from '../../../content/map-source/index.js';
import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { mapItem, mapPreviewUrl, mapSourceItem } from '../map-select-model.js';
import {
  type CatalogueContext,
  chips,
  downloadButton,
  formatCount,
  formatDate,
  kindText,
  pageLink,
  pickButton,
  playersText,
  removeButton,
} from './card.js';
import { type CatalogueRow, canDownload, playerCount } from './model.js';
import { formatBytes } from './query.js';

export interface CatalogueDetail {
  readonly root: HTMLElement;
  /** The entry shown, or null while the panel is closed. */
  readonly shownId: string | null;
  show(row: CatalogueRow, installed: boolean): void;
  close(): void;
}

function fact(list: HTMLElement, label: string, value: string): void {
  const term = node('dt', '', label);
  const detail = node('dd', '', value);
  list.append(term, detail);
}

/** The side panel a card opens: picture, the full description as written, every number the catalogue
 *  knows, the pack's maps and the entry's actions. */
export function catalogueDetail(ctx: CatalogueContext, api: string, onClose: () => void): CatalogueDetail {
  const text = messages().mapCatalogue;
  const root = node('aside', 'catalogue-detail');
  root.hidden = true;
  const close = node('button', 'catalogue-detail__close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', text.details.close);
  close.title = text.details.close;
  const scroll = node('div', 'catalogue-detail__scroll');
  const picture = node('div', 'catalogue-detail__picture');
  const title = node('h2', 'catalogue-detail__title');
  const byline = node('div', 'catalogue-detail__byline');
  const chipRow = node('div');
  const status = node('div', 'catalogue-detail__status');
  status.setAttribute('role', 'status');
  const facts = node('dl', 'catalogue-detail__facts');
  const mapsHead = node('h3', 'catalogue-detail__heading', text.details.maps);
  const maps = node('ul', 'catalogue-detail__maps');
  const descriptionHead = node('h3', 'catalogue-detail__heading', text.details.description);
  const description = node('p', 'catalogue-detail__description');
  scroll.append(picture, title, byline, chipRow, status, facts, mapsHead, maps, descriptionHead, description);
  const actions = node('div', 'catalogue-detail__actions');
  root.append(close, scroll, actions);

  let shownId: string | null = null;
  let pictureLoad = 0;
  close.addEventListener('click', onClose);

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

  const paintStatus = (row: CatalogueRow): void => {
    const conversion = row.entry.conversion;
    const failure = ctx.failure(row.entry.id);
    status.className = `catalogue-detail__status is-${row.status}`;
    status.textContent =
      failure !== undefined
        ? formatMessage(text.downloadFailed, { reason: failure })
        : conversion?.verdict === 'failed'
          ? `${text.status[row.status]}. ${formatMessage(text.failedReason, { message: conversion.message })}`
          : text.status[row.status];
  };

  const paintFacts = (row: CatalogueRow): void => {
    const { entry } = row;
    const details = text.details;
    facts.replaceChildren();
    fact(facts, details.likes, formatCount(entry.likeCount));
    fact(facts, details.downloads, formatCount(entry.downloadCount));
    fact(facts, details.published, formatDate(entry.publishedAt));
    fact(facts, details.updated, formatDate(entry.updatedAt));
    fact(facts, details.version, entry.versionText ?? details.unknown);
    const bytes = entry.file.kind === 'external' ? undefined : entry.file.bytes;
    fact(facts, details.fileSize, bytes === undefined ? details.unknown : formatBytes(bytes, bcp47Tag()));
    fact(facts, details.players, playersText(row.playerCounts) ?? details.unknown);
    fact(
      facts,
      details.languages,
      row.languages.length > 0
        ? row.languages.map((language) => text.languageNames[language]).join(', ')
        : details.unknown,
    );
    const main = row.maps.find((map) => map.index.id === row.mainIndex?.id) ?? row.maps[0];
    fact(
      facts,
      details.size,
      main === undefined || row.size === null
        ? details.unknown
        : `${text.sizes[row.size]} · ${formatMessage(details.cells, main.cells)}`,
    );
    fact(facts, details.category, entry.categoryLabel === '' ? kindText(entry) : entry.categoryLabel);
  };

  const paintMaps = (row: CatalogueRow): void => {
    const many = row.maps.length > 1;
    mapsHead.hidden = !many;
    maps.hidden = !many;
    maps.replaceChildren(
      ...(many
        ? row.maps.map((map) => {
            const item = node('li');
            const players = playersText([playerCount(map.index)].filter((count) => count > 0));
            const parts = [
              ...(players === null ? [] : [players]),
              formatMessage(text.details.cells, map.cells),
            ];
            item.append(
              node('span', 'catalogue-detail__map-name', mapItem(map.index).title),
              node('span', 'catalogue-detail__map-meta', parts.join(' · ')),
            );
            return item;
          })
        : []),
    );
  };

  const paintActions = (row: CatalogueRow, installed: boolean): void => {
    const { entry } = row;
    const downloading = ctx.progress(entry.id) !== undefined;
    const buttons: HTMLElement[] = [];
    if (entry.file.kind === 'external')
      buttons.push(pageLink('main-menu__ghost', text.openPage, entry.file.url));
    else buttons.push(pageLink('main-menu__ghost', text.cataloguePage, entry.source.page));
    if (installed && ctx.canStore) buttons.push(removeButton(entry.id, ctx));
    const offersDownload = ctx.canStore && (downloading || canDownload(row.status));
    if (row.playableMapId !== null) {
      if (offersDownload) buttons.push(downloadButton(row, ctx, 'main-menu__ghost is-accent'));
      buttons.push(pickButton(row, ctx, 'main-menu__primary'));
    } else if (offersDownload) {
      buttons.push(downloadButton(row, ctx, 'main-menu__primary'));
    }
    actions.replaceChildren(...buttons);
  };

  return {
    root,
    get shownId() {
      return shownId;
    },
    show(row, installed) {
      const fresh = shownId !== row.entry.id;
      shownId = row.entry.id;
      root.hidden = false;
      if (fresh) {
        paintPicture(row);
        scroll.scrollTop = 0;
      }
      title.textContent = row.entry.title;
      byline.textContent = formatMessage(text.byAuthor, { author: row.entry.author });
      chipRow.replaceChildren(chips(row));
      paintStatus(row);
      paintFacts(row);
      paintMaps(row);
      const about =
        row.entry.fullDescription.trim() === '' ? row.entry.shortDescription : row.entry.fullDescription;
      description.textContent = about.trim() === '' ? text.details.noDescription : about;
      description.classList.toggle('is-empty', about.trim() === '');
      paintActions(row, installed);
    },
    close() {
      shownId = null;
      pictureLoad++;
      root.hidden = true;
      picture.replaceChildren();
    },
  };
}
