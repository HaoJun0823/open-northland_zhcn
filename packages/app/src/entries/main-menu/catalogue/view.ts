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
import { bcp47Tag, compareLabels, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapSourceItem } from '../map-select-model.js';
import { type CardDate, type CatalogueContext, catalogueCard } from './card.js';
import { catalogueDetail } from './detail.js';
import { catalogueFilters } from './filters.js';
import { installedPane } from './installed.js';
import { type CatalogueRow, catalogueRows, installedGroups } from './model.js';
import { type CatalogueQuery, DEFAULT_CATALOGUE_QUERY, queryRows } from './query.js';

export type CatalogueTab = 'browse' | 'installed';
const CATALOGUE_TABS: readonly CatalogueTab[] = ['browse', 'installed'];

/** Survives leaving the view, so a round trip to the lobby keeps the tab, query and open entry. */
export interface CatalogueMemory {
  tab: CatalogueTab;
  query: CatalogueQuery;
  selectedId: string | null;
}

export function initialCatalogueMemory(): CatalogueMemory {
  return { tab: 'browse', query: DEFAULT_CATALOGUE_QUERY, selectedId: null };
}

export interface CatalogueViewOptions {
  readonly memory: CatalogueMemory;
  /** `play` opens the lobby from the main menu; `choose` picks the map for a multiplayer room. */
  readonly purpose: 'play' | 'choose';
  readonly onPick: (item: MapSelectItem) => void;
  /** Maps were installed or removed; the owner's map lists read their sources again. */
  readonly onInstalledChanged?: () => void;
}

export interface CatalogueView {
  /** The Browse / Installed switch, for the owner's header. */
  readonly tabs: HTMLElement;
  readonly body: HTMLElement;
  dispose(): void;
}

/** The culturesnation.pl catalogue as a filterable card grid with a detail panel and an Installed
 *  tab, for the main menu and a multiplayer room. */
export function catalogueView(options: CatalogueViewOptions): CatalogueView {
  const { memory } = options;
  const text = messages().mapCatalogue;
  const api = apiBaseUrl();
  const store = installedMapStore();
  const scope = new AbortController();

  let entries: readonly CatalogEntry[] | null = null;
  let failure: unknown = null;
  let installed: readonly InstalledMapRecord[] = [];
  let rows: readonly CatalogueRow[] = [];
  /** Download progress per entry id, as a fraction. */
  const downloads = new Map<string, number>();
  /** The last download or removal error per entry id. */
  const failures = new Map<string, string>();
  const cards = new Map<string, ReturnType<typeof catalogueCard> & { readonly dateOf: CardDate }>();

  const rowOf = (entryId: string): CatalogueRow | undefined => rows.find((row) => row.entry.id === entryId);
  const isInstalled = (entryId: string): boolean => installed.some((record) => record.entryId === entryId);

  const ctx: CatalogueContext = {
    purpose: options.purpose,
    canStore: store !== null,
    thumbnail: (entry) => catalogThumbnailUrl(api, entry),
    progress: (entryId) => downloads.get(entryId),
    failure: (entryId) => failures.get(entryId),
    download: (row) => startDownload(row),
    remove: (entryId) => removeInstall(entryId),
    pick: (row) => void pick(row),
    open: (entryId) => openDetail(entryId),
  };

  const tabs = node('div', 'main-menu__seg catalogue__tabs');
  const tabButtons = new Map<CatalogueTab, HTMLButtonElement>();
  for (const tab of CATALOGUE_TABS) {
    const button = node('button', 'main-menu__seg-btn');
    button.type = 'button';
    button.addEventListener('click', () => {
      memory.tab = tab;
      paintTabs();
    });
    tabButtons.set(tab, button);
    tabs.append(button);
  }

  const body = node('div', 'catalogue');
  // The catalogue's own state line: how many maps show, or why none do.
  const status = node('div', 'catalogue__status');
  const statusLine = node('p', 'catalogue__status-line');
  statusLine.setAttribute('role', 'status');
  const retry = node('button', 'main-menu__ghost', text.retry);
  retry.type = 'button';
  retry.hidden = true;
  retry.addEventListener('click', () => void loadCatalogue());
  status.append(statusLine, retry);
  const main = node('div', 'catalogue__main');
  const browse = node('div', 'catalogue__browse');
  const filters = catalogueFilters(memory.query, (query) => {
    memory.query = query;
    renderGrid();
  });
  const results = node('div', 'catalogue__results');
  const scroll = node('div', 'main-menu__map-scroll catalogue__scroll');
  const grid = node('div', 'catalogue__grid');
  scroll.append(grid);
  results.append(filters.toolbar, scroll);
  browse.append(filters.sidebar, results);
  const installedView = installedPane(ctx);
  const detail = catalogueDetail(ctx, api, () => closeDetail());
  main.append(browse, installedView.root, detail.root);
  body.append(status, main);

  function paintTabs(): void {
    const labels = {
      browse: text.tabs.browse,
      installed: formatMessage(text.tabs.installed, { count: installedGroups(installed, rows).length }),
    };
    for (const [tab, button] of tabButtons) {
      button.textContent = labels[tab];
      button.classList.toggle('is-active', tab === memory.tab);
      button.setAttribute('aria-pressed', String(tab === memory.tab));
    }
    browse.hidden = memory.tab !== 'browse';
    installedView.root.hidden = memory.tab !== 'installed';
    if (memory.tab === 'installed') installedView.paint(installedGroups(installed, rows), memory.selectedId);
  }

  function paintDetail(): void {
    const row = memory.selectedId === null ? undefined : rowOf(memory.selectedId);
    if (row === undefined) detail.close();
    else detail.show(row, isInstalled(row.entry.id));
    for (const [id, card] of cards) card.element.classList.toggle('is-selected', id === memory.selectedId);
  }

  function openDetail(entryId: string): void {
    memory.selectedId = entryId;
    paintDetail();
    if (memory.tab === 'installed') paintTabs();
  }

  function closeDetail(): void {
    const was = memory.selectedId;
    memory.selectedId = null;
    paintDetail();
    if (memory.tab === 'installed') paintTabs();
    // The card that opened the panel takes the focus back, so Esc and the arrows keep working.
    if (was !== null) cards.get(was)?.element.focus({ preventScroll: true });
  }

  const paintStatus = (line: string, failed: boolean): void => {
    statusLine.textContent = line;
    status.classList.toggle('is-failed', failed);
    retry.hidden = !failed;
  };

  function renderGrid(): void {
    if (failure !== null || entries === null) {
      paintStatus(failure !== null ? text.unreachable : text.loading, failure !== null);
      grid.replaceChildren();
      return;
    }
    const shown = queryRows(rows, memory.query, compareLabels());
    paintStatus(
      formatMessage(text.countLine, {
        maps: formatMessage(pluralForm(shown.length, text.entries, bcp47Tag()), { count: shown.length }),
      }),
      false,
    );
    if (shown.length === 0) {
      grid.replaceChildren(node('p', 'catalogue__empty', rows.length === 0 ? text.empty : text.noMatch));
      return;
    }
    const dateOf: CardDate = memory.query.sort === 'updated' ? 'updated' : 'published';
    grid.replaceChildren(
      ...shown.map((row) => {
        let card = cards.get(row.entry.id);
        if (card === undefined || card.dateOf !== dateOf) {
          card = { ...catalogueCard(row, ctx, dateOf), dateOf };
          cards.set(row.entry.id, card);
        }
        card.element.classList.toggle('is-selected', row.entry.id === memory.selectedId);
        return card.element;
      }),
    );
  }

  /** Rows and every view over them again, after the catalogue or the installed maps changed. */
  function refreshAll(): void {
    rows = entries === null ? [] : catalogueRows(entries, installed, IR_VERSION);
    cards.clear();
    filters.setRows(rows);
    renderGrid();
    paintTabs();
    paintDetail();
  }

  /** One entry's buttons and status again, while it downloads. */
  function refreshEntry(entryId: string): void {
    const row = rowOf(entryId);
    if (row === undefined) return;
    cards.get(entryId)?.paintAction(row);
    if (detail.shownId === entryId) detail.show(row, isInstalled(entryId));
    if (memory.tab === 'installed') paintTabs();
  }

  async function pick(row: CatalogueRow): Promise<void> {
    if (row.playableMapId === null) return;
    const source = await findMapSource(row.playableMapId);
    if (scope.signal.aborted) return;
    if (source === null || source.stale) {
      failures.set(row.entry.id, text.mapMissing);
      void reloadInstalled();
      return;
    }
    options.onPick(mapSourceItem(source, api));
  }

  function startDownload(row: CatalogueRow): void {
    if (store === null || downloads.has(row.entry.id)) return;
    const id = row.entry.id;
    downloads.set(id, 0);
    failures.delete(id);
    refreshEntry(id);
    void installCatalogEntry(row.entry, {
      api,
      store,
      signal: scope.signal,
      onProgress: ({ done, total }) => {
        downloads.set(id, total === 0 ? 1 : done / total);
        refreshEntry(id);
      },
    })
      .catch((error: unknown) => {
        if (!scope.signal.aborted) failures.set(id, errorText(error));
      })
      .finally(() => {
        downloads.delete(id);
        if (scope.signal.aborted) return;
        void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  }

  function removeInstall(entryId: string): void {
    if (store === null) return;
    failures.delete(entryId);
    void store
      .remove(entryId)
      .catch((error: unknown) => failures.set(entryId, errorText(error)))
      .finally(() => {
        if (!scope.signal.aborted) void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  }

  async function reloadInstalled(): Promise<void> {
    try {
      installed = (await store?.list()) ?? [];
    } catch {
      installed = [];
    }
    if (!scope.signal.aborted) refreshAll();
  }

  async function loadCatalogue(): Promise<void> {
    failure = null;
    entries = null;
    refreshAll();
    try {
      const [catalog] = await Promise.all([fetchCatalog(api), reloadInstalled()]);
      entries = catalog;
    } catch (error) {
      failure = error;
    }
    if (!scope.signal.aborted) refreshAll();
  }

  // Esc closes the open panel before it walks the menu back; a search field with text clears first.
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || memory.selectedId === null) return;
    const field = event.target;
    if (field instanceof HTMLInputElement && field.value !== '') return;
    event.stopPropagation();
    closeDetail();
  });

  paintTabs();
  void loadCatalogue();

  return {
    tabs,
    body,
    dispose: () => scope.abort(),
  };
}
