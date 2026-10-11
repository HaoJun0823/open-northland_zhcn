import { MAP_TEXT_LANGUAGES, type MapTextLanguage } from '@open-northland/data';
import { type DropdownChoice, dropdownControl } from '../../../hud/dom/parts/dropdown.js';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { segControl, togglePill } from '../../../view/settings-controls.js';
import { node } from '../dom.js';
import { type CatalogueRow, MAP_SIZES, type MapSize } from './model.js';
import {
  authorSuggestions,
  CATALOGUE_SORTS,
  type CatalogueQuery,
  type CatalogueSort,
  DEFAULT_CATALOGUE_QUERY,
  hasActiveFilters,
  KIND_FILTERS,
  type KindFilter,
  playerCountChoices,
  STATE_FILTERS,
  type StateFilter,
} from './query.js';

const ANY = 'any';

export interface CatalogueFilters {
  /** Search and sort, above the grid. */
  readonly toolbar: HTMLElement;
  /** Every other filter, in the column beside the grid. */
  readonly sidebar: HTMLElement;
  /** The rows the player count choices and the author suggestions come from. */
  setRows(rows: readonly CatalogueRow[]): void;
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const field = node('div', 'catalogue-filter');
  field.append(node('span', 'catalogue-filter__label', label), control);
  return field;
}

function toggleRow(label: string, on: boolean, onToggle: (on: boolean) => void, hint?: string): HTMLElement {
  const row = node('label', 'catalogue-filter__toggle');
  const pill = togglePill(on, onToggle);
  pill.setAttribute('aria-label', label);
  row.append(node('span', '', label), pill);
  if (hint !== undefined) row.title = hint;
  return row;
}

/** The search, the sort and the filter column; every change hands the whole new query on. */
export function catalogueFilters(
  initial: CatalogueQuery,
  onChange: (query: CatalogueQuery) => void,
): CatalogueFilters {
  const text = messages().mapCatalogue;
  let query = initial;
  let rows: readonly CatalogueRow[] = [];
  const set = (patch: Partial<CatalogueQuery>, repaint = false): void => {
    query = { ...query, ...patch };
    reset.hidden = !hasActiveFilters(query);
    if (repaint) paintSidebar();
    onChange(query);
  };

  const toolbar = node('div', 'catalogue-toolbar');
  const search = quietTextField(node('input', 'main-menu__map-search catalogue-toolbar__search'));
  search.type = 'search';
  search.placeholder = text.searchPlaceholder;
  search.setAttribute('aria-label', text.searchPlaceholder);
  search.value = query.text;
  search.addEventListener('input', () => set({ text: search.value }));
  const sort = dropdownControl<CatalogueSort>({
    label: text.sortLabel,
    className: 'main-menu__dropdown',
    entries: CATALOGUE_SORTS.map((id) => ({ id, label: text.sorts[id] })),
    active: query.sort,
    onPick: (id) => {
      sort.setActive(id);
      set({ sort: id });
    },
  });
  toolbar.append(search, labelled(text.sortLabel, sort.root));

  const sidebar = node('div', 'catalogue-sidebar');
  const fields = node('div', 'catalogue-sidebar__fields');
  const reset = node('button', 'main-menu__ghost catalogue-sidebar__reset', text.resetFilters);
  reset.type = 'button';
  reset.hidden = !hasActiveFilters(query);
  reset.addEventListener('click', () => {
    const { text: typed, sort: order } = query;
    set({ ...DEFAULT_CATALOGUE_QUERY, text: typed, sort: order }, true);
  });
  sidebar.append(fields, reset);

  const dropdown = <T extends string>(
    label: string,
    entries: readonly DropdownChoice<T>[],
    active: T,
    pick: (id: T) => void,
  ): HTMLElement => {
    const control = dropdownControl<T>({
      label,
      className: 'main-menu__dropdown',
      entries,
      active,
      onPick: (id) => {
        control.setActive(id);
        pick(id);
      },
    });
    return labelled(label, control.root);
  };

  const playerChoices = (): DropdownChoice<string>[] => {
    const counts = playerCountChoices(rows);
    const players = messages().mainMenu.mapSelect.players;
    return [
      { id: ANY, label: text.anyPlayers },
      ...counts.map((count) => ({
        id: String(count),
        label: formatMessage(pluralForm(count, players, bcp47Tag()), { count }),
      })),
    ];
  };

  const authorField = (): HTMLElement => {
    const box = node('div', 'catalogue-author');
    const input = quietTextField(node('input', 'main-menu__map-search catalogue-author__input'));
    input.type = 'text';
    input.placeholder = text.authorPlaceholder;
    input.setAttribute('aria-label', text.filterLabels.author);
    input.autocomplete = 'off';
    input.value = query.author;
    const list = node('div', 'catalogue-author__list');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const suggest = (): void => {
      const names = authorSuggestions(rows, input.value);
      list.replaceChildren(
        ...names.map((name) => {
          const option = node('button', 'catalogue-author__option', name);
          option.type = 'button';
          option.setAttribute('role', 'option');
          // Before the field's blur hides the list.
          option.addEventListener('pointerdown', (event) => event.preventDefault());
          option.addEventListener('click', () => {
            input.value = name;
            list.hidden = true;
            set({ author: name });
          });
          return option;
        }),
      );
      list.hidden = names.length === 0;
    };
    input.addEventListener('input', () => {
      suggest();
      set({ author: input.value });
    });
    input.addEventListener('focus', suggest);
    input.addEventListener('blur', () => {
      list.hidden = true;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && !list.hidden) {
        event.preventDefault();
        list.querySelector('button')?.focus();
      }
    });
    list.addEventListener('keydown', (event) => {
      const options = [...list.querySelectorAll('button')];
      const at = options.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const next = options[at + (event.key === 'ArrowDown' ? 1 : -1)];
      (next ?? input).focus();
    });
    box.append(input, list);
    return labelled(text.filterLabels.author, box);
  };

  const paintSidebar = (): void => {
    const labels = text.filterLabels;
    const state = segControl<StateFilter>(
      STATE_FILTERS.map((id) => ({ id, label: text.states[id] })),
      query.state,
      (id) => {
        state.setActive(id);
        set({ state: id });
      },
    );
    state.root.classList.add('catalogue-filter__seg');
    fields.replaceChildren(
      dropdown<KindFilter>(
        labels.kind,
        KIND_FILTERS.map((id) => ({ id, label: text.kinds[id] })),
        query.kind,
        (kind) => set({ kind }),
      ),
      toggleRow(text.seriesOnly, query.seriesOnly, (seriesOnly) => set({ seriesOnly })),
      dropdown<string>(
        labels.players,
        playerChoices(),
        query.players === null ? ANY : String(query.players),
        (id) => set({ players: id === ANY ? null : Number(id) }),
      ),
      dropdown<MapTextLanguage | typeof ANY>(
        labels.language,
        [
          { id: ANY, label: text.anyLanguage },
          ...MAP_TEXT_LANGUAGES.map((id) => ({ id, label: text.languageNames[id] })),
        ],
        query.language ?? ANY,
        (id) => set({ language: id === ANY ? null : id }),
      ),
      dropdown<MapSize | typeof ANY>(
        labels.size,
        [{ id: ANY, label: text.sizes.any }, ...MAP_SIZES.map((id) => ({ id, label: text.sizes[id] }))],
        query.size ?? ANY,
        (id) => set({ size: id === ANY ? null : id }),
      ),
      authorField(),
      labelled(labels.state, state.root),
      toggleRow(text.readyOnly, query.readyOnly, (readyOnly) => set({ readyOnly }), text.readyHint),
      toggleRow(text.showExternal, query.showExternal, (showExternal) => set({ showExternal })),
    );
  };
  paintSidebar();

  return {
    toolbar,
    sidebar,
    setRows(next) {
      const before = playerCountChoices(rows).join();
      rows = next;
      // Repainting would drop the focus of a field the player is typing in.
      if (playerCountChoices(rows).join() !== before) paintSidebar();
    },
  };
}
