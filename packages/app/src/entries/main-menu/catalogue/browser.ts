import type { CatalogEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import {
  apiBaseUrl,
  catalogThumbnailUrl,
  fetchCatalog,
  findMapSource,
  type InstalledMapRecord,
  installCatalogEntry,
  installedMapStore,
} from '../../../content/map-source/index.js';
import { errorText } from '../../../diag/error-text.js';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { listedIn, type MapSelectItem, mapSourceItem } from '../map-select-model.js';
import {
  CATALOGUE_FILTERS,
  type CatalogueMemory,
  type CatalogueRow,
  canDownload,
  catalogueRows,
  filterCatalogueRows,
  languageCodes,
  playerCount,
} from './model.js';

const PERCENT = 100;

export interface CatalogueBrowserOptions {
  readonly memory: CatalogueMemory;
  /** `play` starts the map from New Game; `choose` picks it for a multiplayer room. */
  readonly purpose: 'play' | 'choose';
  readonly onPick: (item: MapSelectItem) => void;
  /** Maps were installed or removed; the owner's map lists read their sources again. */
  readonly onInstalledChanged?: () => void;
}

export interface CatalogueBrowser {
  readonly tabs: HTMLElement;
  readonly body: HTMLElement;
  dispose(): void;
}

function thumbImage(url: string | null, lazy: boolean): HTMLImageElement | null {
  if (url === null) return null;
  const img = node('img');
  img.src = url;
  img.alt = '';
  if (lazy) img.loading = 'lazy';
  // A missing screenshot leaves the frame's gradient instead of a broken-image glyph.
  img.addEventListener('error', () => img.remove());
  return img;
}

/** A link that opens in a new tab, or in the system browser on the desktop. */
function pageLink(text: string, href: string): HTMLAnchorElement {
  const link = node('a', 'main-menu__ghost catalogue__link', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/** The culturesnation.pl catalogue as a filterable list with a details card, for New Game and a room. */
export function catalogueBrowser(options: CatalogueBrowserOptions): CatalogueBrowser {
  const { memory } = options;
  const copy = messages().mainMenu;
  const text = messages().mapCatalogue;
  const api = apiBaseUrl();
  const store = installedMapStore();
  const scope = new AbortController();

  const tabs = node('div', 'main-menu__seg');
  const tabButtons = new Map<string, HTMLButtonElement>();
  for (const filter of CATALOGUE_FILTERS) {
    const button = node('button', 'main-menu__seg-btn', text.filters[filter]);
    button.type = 'button';
    button.addEventListener('click', () => {
      memory.filter = filter;
      paintTabs();
      renderList();
    });
    tabButtons.set(filter, button);
    tabs.append(button);
  }
  const paintTabs = (): void => {
    for (const [key, button] of tabButtons) {
      button.classList.toggle('is-active', key === memory.filter);
      button.setAttribute('aria-pressed', String(key === memory.filter));
    }
  };

  const body = node('div', 'main-menu__map-body catalogue');
  const listCol = node('div', 'main-menu__map-list-col');
  const search = quietTextField(node('input', 'main-menu__map-search'));
  search.type = 'search';
  search.placeholder = text.searchPlaceholder;
  search.setAttribute('aria-label', text.searchPlaceholder);
  search.value = memory.query;
  const listScroll = node('div', 'main-menu__map-scroll');
  const list = node('div', 'main-menu__map-list');
  listScroll.append(list);
  const count = node('div', 'main-menu__map-count');
  listCol.append(search, listScroll, count);

  const previewCol = node('div', 'main-menu__map-preview-col');
  const card = node('div', 'main-menu__map-card catalogue__card');
  card.hidden = true;
  const frame = node('div', 'main-menu__map-preview catalogue__preview');
  const details = node('div', 'main-menu__map-details');
  const name = node('div', 'main-menu__map-name');
  const meta = node('div', 'main-menu__map-meta');
  const byline = node('div', 'catalogue__byline');
  const facts = node('div', 'catalogue__facts');
  const status = node('div', 'catalogue__status');
  status.setAttribute('role', 'status');
  const description = node('p', 'main-menu__map-desc catalogue__desc');
  const actions = node('div', 'main-menu__map-actions catalogue__actions');
  details.append(name, meta, byline, facts, status, description, actions);
  card.append(frame, details);
  previewCol.append(card);
  body.append(listCol, previewCol);

  let entries: readonly CatalogEntry[] | null = null;
  let installed: readonly InstalledMapRecord[] = [];
  let failure: unknown = null;
  let selected: CatalogueRow | null = null;
  /** Download progress per entry id, as a fraction. */
  const downloads = new Map<string, number>();
  /** The last download error per entry id, shown on its card until the next attempt. */
  const downloadErrors = new Map<string, string>();
  const rowButtons = new Map<string, HTMLButtonElement>();

  const rows = (): readonly CatalogueRow[] =>
    entries === null ? [] : catalogueRows(entries, installed, IR_VERSION);

  const metaLine = (row: CatalogueRow): string => {
    const parts = [text.categoryNames[row.entry.category]];
    const players = playerCount(row.main);
    if (players > 0)
      parts.push(formatMessage(pluralForm(players, copy.mapSelect.players, bcp47Tag()), { count: players }));
    if (row.subMapCount > 0)
      parts.push(
        formatMessage(pluralForm(row.subMapCount, text.subMaps, bcp47Tag()), { count: row.subMapCount }),
      );
    return parts.join(' · ');
  };

  const statusText = (row: CatalogueRow): string => {
    const progress = downloads.get(row.entry.id);
    if (progress !== undefined)
      return formatMessage(text.downloading, { percent: Math.round(progress * PERCENT) });
    return text.status[row.status];
  };

  const rowButton = (row: CatalogueRow): HTMLButtonElement => {
    const button = node('button', 'main-menu__map-row');
    button.type = 'button';
    button.dataset.entryId = row.entry.id;
    const thumb = node('div', 'main-menu__map-thumb');
    const img = thumbImage(catalogThumbnailUrl(api, row.entry), true);
    if (img !== null) thumb.append(img);
    const rowText = node('div', 'main-menu__map-row-text');
    const rowName = node('div', 'main-menu__map-row-name', row.entry.title);
    const rowMeta = node('div', 'main-menu__map-row-meta');
    const badge = node('span', `catalogue__badge is-${row.status}`, statusText(row));
    rowMeta.append(`${row.entry.author} · `, badge);
    rowText.append(rowName, rowMeta);
    button.append(thumb, rowText);
    button.addEventListener('click', () => selectRow(row));
    return button;
  };

  const pickItem = async (row: CatalogueRow): Promise<MapSelectItem | null> => {
    if (row.playableMapId === null) return null;
    const source = await findMapSource(row.playableMapId);
    return source === null || source.stale ? null : mapSourceItem(source, api);
  };

  const startDownload = (row: CatalogueRow): void => {
    if (store === null || downloads.has(row.entry.id)) return;
    downloads.set(row.entry.id, 0);
    downloadErrors.delete(row.entry.id);
    renderList();
    void installCatalogEntry(row.entry, {
      api,
      store,
      signal: scope.signal,
      onProgress: ({ done, total }) => {
        downloads.set(row.entry.id, total === 0 ? 1 : done / total);
        if (selected?.entry.id === row.entry.id) {
          status.textContent = statusText(selected);
          paintActions(selected);
        }
        const badge = rowButtons.get(row.entry.id)?.querySelector('.catalogue__badge');
        if (badge) badge.textContent = statusText(row);
      },
    })
      .catch((error: unknown) => {
        if (!scope.signal.aborted) downloadErrors.set(row.entry.id, errorText(error));
      })
      .finally(() => {
        downloads.delete(row.entry.id);
        if (scope.signal.aborted) return;
        void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  };

  const removeInstall = (row: CatalogueRow): void => {
    if (store === null) return;
    void store
      .remove(row.entry.id)
      .catch((error: unknown) => downloadErrors.set(row.entry.id, errorText(error)))
      .finally(() => {
        if (!scope.signal.aborted) void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  };

  const actionButton = (className: string, label: string, action: () => void): HTMLButtonElement => {
    const button = node('button', className, label);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  };

  /** The play or choose button; enabled once the installed map resolves and suits the purpose. */
  const pickButton = (row: CatalogueRow): HTMLButtonElement => {
    let picked: MapSelectItem | null = null;
    const button = actionButton(
      'main-menu__primary',
      options.purpose === 'choose' ? text.choose : text.play,
      () => {
        if (picked !== null) options.onPick(picked);
      },
    );
    button.disabled = true;
    void pickItem(row).then((item) => {
      if (item === null || !button.isConnected) return;
      const allowed =
        options.purpose === 'play' || (listedIn(item, 'multiplayer') && hasClaimableSeat(item.players));
      picked = allowed ? item : null;
      button.disabled = !allowed;
      if (!allowed) button.title = text.notMultiplayer;
    });
    return button;
  };

  /** Right-aligned, the main action last. A pending entry offers nothing to click. */
  const paintActions = (row: CatalogueRow): void => {
    const downloading = downloads.has(row.entry.id);
    const downloadLabel = downloading
      ? statusText(row)
      : row.status === 'updatable'
        ? text.update
        : row.status === 'redownload'
          ? text.redownload
          : text.download;
    const download = (className: string): HTMLButtonElement => {
      const button = actionButton(className, downloadLabel, () => startDownload(row));
      button.disabled = downloading;
      return button;
    };
    const buttons: HTMLElement[] = [];
    if (row.entry.file.kind === 'external') buttons.push(pageLink(text.openPage, row.entry.file.url));
    else if (row.status === 'failed') buttons.push(pageLink(text.openPage, row.entry.source.page));
    else if (row.status !== 'pending') buttons.push(pageLink(text.cataloguePage, row.entry.source.page));
    if (row.playableMapId !== null) {
      if (store !== null) {
        const remove = actionButton('main-menu__ghost', text.remove, () => removeInstall(row));
        remove.disabled = downloading;
        buttons.unshift(remove);
      }
      if (canDownload(row.status) && store !== null) buttons.push(download('main-menu__ghost is-accent'));
      buttons.push(pickButton(row));
    } else if (canDownload(row.status) && store !== null) {
      buttons.push(download('main-menu__primary'));
    }
    actions.replaceChildren(...buttons);
  };

  const paintCard = (row: CatalogueRow): void => {
    card.hidden = false;
    const img = thumbImage(catalogThumbnailUrl(api, row.entry), false);
    frame.replaceChildren(...(img === null ? [] : [img]));
    name.textContent = row.entry.title;
    meta.textContent = metaLine(row);
    byline.textContent = formatMessage(text.byAuthor, { author: row.entry.author });
    const languages = row.main?.languages ?? [];
    const lines = [
      ...(languages.length > 0
        ? [formatMessage(text.languages, { languages: languageCodes(languages) })]
        : []),
      ...(row.entry.versionText === undefined
        ? []
        : [formatMessage(text.version, { version: row.entry.versionText })]),
    ];
    facts.textContent = lines.join(' · ');
    facts.hidden = lines.length === 0;
    const conversion = row.entry.conversion;
    const error = downloadErrors.get(row.entry.id);
    status.className = `catalogue__status is-${row.status}`;
    status.textContent =
      error !== undefined
        ? formatMessage(text.downloadFailed, { reason: error })
        : conversion?.verdict === 'failed'
          ? `${statusText(row)}. ${formatMessage(text.failedReason, { message: conversion.message })}`
          : statusText(row);
    const about =
      row.entry.fullDescription.trim() === '' ? row.entry.shortDescription : row.entry.fullDescription;
    description.textContent = about;
    description.hidden = about.trim() === '';
    paintActions(row);
  };

  const selectRow = (row: CatalogueRow): void => {
    selected = row;
    memory.selectedId = row.entry.id;
    for (const [id, button] of rowButtons) {
      const on = id === row.entry.id;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    paintCard(row);
  };

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const shown = filterCatalogueRows(rows(), memory.filter, search.value);
    const index = shown.findIndex((row) => row.entry.id === selected?.entry.id);
    const next = shown[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next === undefined) return;
    selectRow(next);
    rowButtons.get(next.entry.id)?.focus();
  });

  const notice = (message: string, retry: boolean): void => {
    const paragraph = node('p', 'main-menu__map-empty', message);
    list.replaceChildren(paragraph);
    if (retry) {
      const again = node('button', 'main-menu__ghost', text.retry);
      again.type = 'button';
      again.addEventListener('click', () => void loadCatalogue());
      list.append(again);
    }
    count.textContent = '';
    card.hidden = true;
    selected = null;
  };

  function renderList(): void {
    rowButtons.clear();
    if (failure !== null || entries === null) {
      notice(failure !== null ? text.unreachable : text.loading, failure !== null);
      return;
    }
    const all = rows();
    const shown = filterCatalogueRows(all, memory.filter, search.value);
    const mapsText = formatMessage(pluralForm(shown.length, text.entries, bcp47Tag()), {
      count: shown.length,
    });
    if (shown.length === 0) {
      notice(all.length === 0 ? text.empty : text.noMatch, false);
      return;
    }
    for (const row of shown) rowButtons.set(row.entry.id, rowButton(row));
    list.replaceChildren(...rowButtons.values());
    count.textContent = formatMessage(text.countLine, { maps: mapsText });
    const current = shown.find((row) => row.entry.id === memory.selectedId) ?? shown[0];
    if (current !== undefined) selectRow(current);
  }

  async function reloadInstalled(): Promise<void> {
    try {
      installed = (await store?.list()) ?? [];
    } catch {
      installed = [];
    }
    if (!scope.signal.aborted) renderList();
  }

  async function loadCatalogue(): Promise<void> {
    failure = null;
    entries = null;
    renderList();
    try {
      const [catalog] = await Promise.all([fetchCatalog(api), reloadInstalled()]);
      entries = catalog;
    } catch (error) {
      failure = error;
    }
    if (!scope.signal.aborted) renderList();
  }

  search.addEventListener('input', () => {
    memory.query = search.value;
    renderList();
  });
  paintTabs();
  void loadCatalogue();

  return {
    tabs,
    body,
    dispose: () => scope.abort(),
  };
}
