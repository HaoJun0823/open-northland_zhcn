import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import { formatPlaytime, formatSavedAt } from '../../../view/runtime/save-load/list-model.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import type { WorldNameOf } from '../../../view/runtime/save-load/world-names.js';
import { GLYPH } from '../icons.js';
import { button, element, setTip } from '../parts/dom.js';
import { foldedName } from '../parts/name-search.js';

export interface SlotSheetOptions {
  /** A row the running world cannot load: dimmed and tagged, still selectable for export and delete. */
  readonly foreign?: (slot: SaveSlotInfo) => boolean;
  readonly emptyHint: string;
  readonly onSelect: (slot: SaveSlotInfo | null) => void;
  /** Double click or Enter on a row. */
  readonly onActivate?: (slot: SaveSlotInfo) => void;
  readonly onDelete: (slot: SaveSlotInfo) => void;
}

export interface SlotSheet {
  readonly el: HTMLElement;
  /** Draw these slots, keeping the selection by id when it is still listed. */
  show(slots: readonly SaveSlotInfo[], worldName: WorldNameOf): void;
  /** The store could not be read: the list says so instead of looking empty. */
  showFailure(text: string): void;
  filter(query: string): void;
  select(id: string | null): void;
  selected(): SaveSlotInfo | null;
  /** Focus the selected row, or the first one. */
  focus(): boolean;
}

interface Row {
  readonly slot: SaveSlotInfo;
  readonly item: HTMLLIElement;
  readonly pick: HTMLButtonElement;
  readonly del: HTMLButtonElement;
  /** Name and map, folded for the search. */
  readonly haystack: string;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}

/** The saves on a parchment sheet: newest first, one selected row, a bin on the row it belongs to. */
export function createSlotSheet(opts: SlotSheetOptions): SlotSheet {
  const copy = messages().saveList;
  const el = element('div', 'on-parchment on-saves__sheet');
  const head = element('div', 'on-saves__head');
  for (const label of [copy.columnName, copy.columnPlaytime, copy.columnSavedAt]) {
    head.append(textElement('span', '', label));
  }
  const list = element('ul', 'on-saves__list');
  list.setAttribute('aria-label', copy.columnName);
  const empty = element('div', 'on-saves__empty');
  empty.setAttribute('role', 'status');
  el.append(head, list, empty);

  let rows: Row[] = [];
  let current: Row | null = null;
  /** The selection a search hid, picked again once the search shows it. */
  let filteredOut: Row | null = null;
  let query = '';

  const visible = (): Row[] => rows.filter((row) => !row.item.hidden);

  const mark = (): void => {
    const shown = visible();
    // Roving tab stop: the selected row, or the first one, is the list's only stop.
    const stop = current !== null && !current.item.hidden ? current : (shown[0] ?? null);
    for (const row of rows) {
      const on = row === current;
      row.item.classList.toggle('is-selected', on);
      row.pick.setAttribute('aria-pressed', String(on));
      row.pick.tabIndex = row === stop ? 0 : -1;
      row.del.tabIndex = on ? 0 : -1;
    }
  };

  const choose = (row: Row | null): void => {
    if (row !== null) filteredOut = null;
    if (row === current) return;
    current = row;
    mark();
    opts.onSelect(row?.slot ?? null);
  };

  const showEmpty = (title: string, hint: string): void => {
    empty.replaceChildren(textElement('strong', '', title), textElement('span', '', hint));
    empty.hidden = false;
  };

  const applyFilter = (): void => {
    const needle = foldedName(query);
    for (const row of rows) row.item.hidden = needle !== '' && !row.haystack.includes(needle);
    if (current?.item.hidden === true) {
      filteredOut = current;
      choose(null);
    } else if (current === null && filteredOut !== null && !filteredOut.item.hidden) choose(filteredOut);
    const shown = visible().length;
    head.hidden = shown === 0;
    if (rows.length === 0) showEmpty(copy.empty, opts.emptyHint);
    else if (shown === 0) showEmpty(formatMessage(copy.noMatch, { query: query.trim() }), '');
    else empty.hidden = true;
    mark();
  };

  const rowOf = (slot: SaveSlotInfo, worldName: WorldNameOf): Row => {
    const world = worldName(slot.mapId);
    const item = element('li', 'on-saves__row');
    const pick = button('on-saves__pick');
    const title = element('span', 'on-saves__title');
    const map = textElement('span', 'on-saves__map', world ?? '-');
    title.append(textElement('strong', 'on-saves__name', slot.name), map);
    pick.append(
      title,
      textElement('span', 'on-saves__num', slot.tick !== null ? formatPlaytime(slot.tick) : '-'),
      textElement('span', 'on-saves__num', formatSavedAt(slot.savedAt, bcp47Tag())),
    );
    if (opts.foreign?.(slot) === true) {
      item.classList.add('is-foreign');
      map.append(textElement('span', 'on-saves__tag', copy.otherWorld));
    }
    const del = button('on-saves__del', GLYPH.bin);
    const delLabel = formatMessage(copy.deleteNamed, { name: slot.name });
    del.setAttribute('aria-label', delLabel);
    setTip(del, delLabel);
    item.append(pick, del);
    const row: Row = { slot, item, pick, del, haystack: foldedName(`${slot.name} ${world ?? ''}`) };
    pick.addEventListener('click', () => choose(row));
    pick.addEventListener('dblclick', () => opts.onActivate?.(slot));
    // The confirmation names the save, so the bin leaves the selection and what it filled alone.
    del.addEventListener('click', () => opts.onDelete(slot));
    return row;
  };

  list.addEventListener('keydown', (event) => {
    const shown = visible();
    const at = current === null ? -1 : shown.indexOf(current);
    let next: Row | undefined;
    if (event.key === 'ArrowDown') next = shown[Math.min(at + 1, shown.length - 1)];
    else if (event.key === 'ArrowUp') next = shown[Math.max(at - 1, 0)];
    else if (event.key === 'Home') next = shown[0];
    else if (event.key === 'End') next = shown.at(-1);
    else if (event.key === 'Enter' && current !== null && event.target === current.pick) {
      event.preventDefault();
      opts.onActivate?.(current.slot);
      return;
    } else if (event.key === 'Delete' && current !== null) {
      event.preventDefault();
      opts.onDelete(current.slot);
      return;
    } else return;
    event.preventDefault();
    if (next === undefined) return;
    choose(next);
    next.pick.focus();
    next.item.scrollIntoView({ block: 'nearest' });
  });

  return {
    el,
    show(slots, worldName) {
      const keep = current?.slot.id ?? null;
      rows = slots.map((slot) => rowOf(slot, worldName));
      list.replaceChildren(...rows.map((row) => row.item));
      current = rows.find((row) => row.slot.id === keep) ?? null;
      filteredOut = null;
      if (current === null && keep !== null) opts.onSelect(null);
      applyFilter();
    },
    showFailure(text) {
      rows = [];
      list.replaceChildren();
      head.hidden = true;
      if (current !== null) choose(null);
      showEmpty(text, '');
    },
    filter(next) {
      query = next;
      applyFilter();
    },
    select(id) {
      const row = rows.find((candidate) => candidate.slot.id === id) ?? null;
      filteredOut = null;
      // A row the search hides waits for it, so no action ever runs on a save the player cannot see.
      if (row?.item.hidden === true) {
        choose(null);
        filteredOut = row;
        return;
      }
      choose(row);
      row?.item.scrollIntoView({ block: 'nearest' });
    },
    selected: () => current?.slot ?? null,
    focus() {
      const target = current !== null && !current.item.hidden ? current : visible()[0];
      target?.pick.focus();
      return target !== undefined;
    },
  };
}
