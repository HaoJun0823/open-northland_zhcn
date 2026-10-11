import type { CatalogEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import {
  apiBaseUrl,
  catalogFileUrl,
  catalogThumbnailUrl,
  fetchCatalog,
  findMapSource,
  type InstalledMapRecord,
  installCatalogEntry,
  installedMapStore,
  loadMapSources,
} from '../../../content/map-source/index.js';
import { errorText } from '../../../diag/error-text.js';
import { bcp47Tag, compareLabels, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapSourceItem } from '../map-select-model.js';
import { type CardDate, type CatalogueContext, catalogueCard, formatCount } from './card.js';
import { catalogueDetail } from './detail.js';
import { catalogueFilters } from './filters.js';
import { installedPane } from './installed.js';
import {
  type CatalogueRow,
  catalogueRows,
  type InstalledGroup,
  installedGroups,
  type ShippedMaps,
  shippedMaps,
} from './model.js';
import { type CatalogueQuery, DEFAULT_CATALOGUE_QUERY, hasActiveFilters, queryRows } from './query.js';

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
  /** How many maps the catalogue lists or the filters show, for the owner's header before the tabs. */
  readonly count: HTMLElement;
  readonly body: HTMLElement;
  dispose(): void;
}

/** Cards in the grid's first rendered row: how far the Up and Down keys move. */
function gridColumns(cards: readonly HTMLElement[]): number {
  const top = cards[0]?.offsetTop;
  return Math.max(1, cards.filter((card) => card.offsetTop === top).length);
}

const isUpdate = (group: InstalledGroup): boolean =>
  group.row?.status === 'updatable' || group.row?.status === 'redownload';

/** The culturesnation.pl catalogue as a filterable card grid beside a detail panel that always shows
 *  the selected entry, with an Installed tab, for the main menu and a multiplayer room. */
export function catalogueView(options: CatalogueViewOptions): CatalogueView {
  const { memory } = options;
  const text = messages().mapCatalogue;
  const api = apiBaseUrl();
  const store = installedMapStore();
  const scope = new AbortController();

  let entries: readonly CatalogEntry[] | null = null;
  let failure: unknown = null;
  let installed: readonly InstalledMapRecord[] = [];
  let shipped: ShippedMaps = new Map();
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
    fileUrl: (entry) => catalogFileUrl(api, entry),
    progress: (entryId) => downloads.get(entryId),
    failure: (entryId) => failures.get(entryId),
    download: (row) => startDownload(row),
    remove: (entryId) => removeInstall(entryId),
    pick: (row) => void pick(row),
    open: (entryId) => select(entryId),
  };

  const tabs = node('div', 'main-menu__seg catalogue__tabs');
  const tabButtons = new Map<CatalogueTab, HTMLButtonElement>();
  for (const tab of CATALOGUE_TABS) {
    const button = node('button', 'main-menu__seg-btn');
    button.type = 'button';
    button.addEventListener('click', () => {
      memory.tab = tab;
      render();
    });
    tabButtons.set(tab, button);
    tabs.append(button);
  }
  const count = node('p', 'catalogue__count');
  count.setAttribute('role', 'status');

  const body = node('div', 'catalogue');
  const filters = catalogueFilters(memory.query, (query) => {
    memory.query = query;
    render();
  });
  const main = node('div', 'catalogue__main');
  const results = node('div', 'catalogue__results');
  const scroll = node('div', 'main-menu__map-scroll catalogue__scroll');
  const grid = node('div', 'catalogue__grid');
  scroll.append(grid);
  results.append(scroll);
  const installedView = installedPane(ctx);
  const detail = catalogueDetail(ctx, api, (author) => filters.update({ author }));
  main.append(results, installedView.root, detail.root);
  body.append(filters.root, main);

  /** A line in the grid's place, with the one button that can change it. */
  const notice = (line: string, action: { label: string; run: () => void } | null): HTMLElement => {
    const box = node('div', 'catalogue__notice');
    box.append(node('p', 'catalogue__notice-line', line));
    if (action !== null) {
      const button = node('button', 'main-menu__ghost', action.label);
      button.type = 'button';
      button.addEventListener('click', action.run);
      box.append(button);
    }
    return box;
  };

  function paintTabs(groups: readonly InstalledGroup[]): void {
    const updates = groups.filter(isUpdate).length;
    for (const [tab, button] of tabButtons) {
      const active = tab === memory.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      if (tab === 'browse') {
        button.textContent = text.tabs.browse;
        continue;
      }
      button.replaceChildren(formatMessage(text.tabs.installed, { count: groups.length }));
      button.removeAttribute('title');
      if (updates > 0) {
        button.title = formatMessage(text.tabUpdatesTitle, { count: updates });
        button.append(node('span', 'catalogue__tab-updates', formatCount(updates)));
      }
    }
    filters.root.hidden = memory.tab !== 'browse';
    results.hidden = memory.tab !== 'browse';
    installedView.root.hidden = memory.tab !== 'installed';
  }

  /** Keeps the selection while it is among `ids`, else moves it to the first of them. */
  function keepSelection(ids: readonly string[]): void {
    if (memory.selectedId === null || !ids.includes(memory.selectedId)) memory.selectedId = ids[0] ?? null;
  }

  function paintDetail(emptyLine: string | null): void {
    const row = memory.selectedId === null ? undefined : rowOf(memory.selectedId);
    if (row === undefined) detail.clear(emptyLine);
    else detail.show(row, isInstalled(row.entry.id));
  }

  function paintSelection(): void {
    for (const [id, card] of cards) {
      const selected = id === memory.selectedId;
      card.element.classList.toggle('is-selected', selected);
      // One tab stop for the whole grid: the selected card; the arrows walk the rest.
      card.element.tabIndex = selected ? 0 : -1;
    }
  }

  function renderGrid(): void {
    if (failure !== null || entries === null) {
      count.textContent = '';
      grid.replaceChildren(
        failure !== null
          ? notice(text.unreachable, { label: text.retry, run: () => void loadCatalogue() })
          : notice(text.loading, null),
      );
      memory.selectedId = null;
      paintDetail(null);
      return;
    }
    const shown = queryRows(rows, memory.query, compareLabels());
    const filtered = hasActiveFilters(memory.query) || memory.query.text.trim() !== '';
    count.textContent = filtered
      ? formatMessage(text.countFiltered, {
          shown: formatCount(shown.length),
          total: formatCount(rows.length),
        })
      : formatMessage(text.countLine, {
          maps: formatMessage(pluralForm(rows.length, text.entries, bcp47Tag()), { count: rows.length }),
        });
    keepSelection(shown.map((row) => row.entry.id));
    if (shown.length === 0) {
      grid.replaceChildren(
        rows.length === 0
          ? notice(text.empty, null)
          : notice(
              text.noMatch,
              hasActiveFilters(memory.query) ? { label: text.resetFilters, run: filters.reset } : null,
            ),
      );
      paintDetail(text.panelEmpty);
      return;
    }
    const sort = memory.query.sort;
    const dateOf: CardDate = sort === 'updated' ? 'updated' : sort === 'newest' ? 'published' : null;
    grid.replaceChildren(
      ...shown.map((row) => {
        let card = cards.get(row.entry.id);
        if (card === undefined || card.dateOf !== dateOf) {
          card = { ...catalogueCard(row, ctx, dateOf), dateOf };
          cards.set(row.entry.id, card);
        }
        return card.element;
      }),
    );
    paintSelection();
    paintDetail(text.panelEmpty);
  }

  function renderInstalled(groups: readonly InstalledGroup[]): void {
    keepSelection(groups.filter((group) => group.row !== null).map((group) => group.entryId));
    installedView.paint(groups, memory.selectedId);
    paintDetail(text.panelEmpty);
  }

  /** The tabs and the open tab's content and panel, after any change to the rows, query or tab. */
  function render(): void {
    const groups = installedGroups(installed, rows);
    paintTabs(groups);
    if (memory.tab === 'browse') renderGrid();
    else renderInstalled(groups);
  }

  function select(entryId: string): void {
    memory.selectedId = entryId;
    paintSelection();
    paintDetail(text.panelEmpty);
    if (memory.tab === 'installed') installedView.paint(installedGroups(installed, rows), memory.selectedId);
  }

  // Arrows walk the grid and the selection follows; Enter or Space hands the focus to the panel's
  // action, so nothing downloads from one key press on the grid.
  grid.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('catalogue-card')) return;
    const all = [...grid.querySelectorAll<HTMLElement>('.catalogue-card')];
    const at = all.indexOf(target);
    const columns = gridColumns(all);
    const steps: Readonly<Record<string, number>> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      ArrowDown: at + columns,
      ArrowUp: at - columns,
      Home: 0,
      End: all.length - 1,
    };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      detail.focusAction();
      return;
    }
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const card = all[Math.min(all.length - 1, Math.max(0, next))];
    const id = card?.dataset.entryId;
    if (card === undefined || id === undefined) return;
    select(id);
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  });

  /** Rows and every view over them again, after the catalogue or the installed maps changed. */
  function refreshAll(): void {
    rows = entries === null ? [] : catalogueRows(entries, installed, IR_VERSION, shipped);
    cards.clear();
    filters.setRows(rows);
    render();
  }

  /** One entry's progress, panel and Installed row again, while it downloads. */
  function refreshEntry(entryId: string): void {
    const row = rowOf(entryId);
    if (row === undefined) return;
    cards.get(entryId)?.paintProgress();
    if (detail.shownId === entryId) detail.show(row, isInstalled(entryId));
    if (memory.tab === 'installed') installedView.paint(installedGroups(installed, rows), memory.selectedId);
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
      const [catalog, sources] = await Promise.all([fetchCatalog(api), loadMapSources(), reloadInstalled()]);
      entries = catalog;
      shipped = shippedMaps(
        sources.filter((source) => source.catalog === undefined).map(({ entry }) => entry),
      );
    } catch (error) {
      failure = error;
    }
    if (!scope.signal.aborted) refreshAll();
  }

  render();
  void loadCatalogue();

  return {
    tabs,
    count,
    body,
    dispose: () => scope.abort(),
  };
}
