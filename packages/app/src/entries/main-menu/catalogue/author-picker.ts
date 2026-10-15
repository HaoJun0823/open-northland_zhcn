import { foldText, searchWords } from '../../../hud/dom/parts/name-search.js';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { FIELD_KEYS_ATTRIBUTE } from '../../../hud/hotkeys.js';
import { compareLabels, formatMessage, messages } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { formatCount } from './card.js';
import { type AuthorCount, authorListing } from './query.js';

/** Viewport px between the pill and its popover, and the popover and the window edge. */
const POPOVER_GAP_PX = 4;

export interface AuthorPicker {
  /** The pill: caption, current author and the clear button; the popover opens under it. */
  readonly root: HTMLElement;
  setAuthors(authors: readonly AuthorCount[]): void;
  setActive(author: string | null): void;
}

/** `name` with each folded word it holds marked, so a typed "zolw" lights "Żółw". */
function highlighted(name: string, words: readonly string[]): Node[] {
  // Folded one character at a time, so each folded offset maps back to its source character.
  const chars = [...name];
  const folded = chars.map((char) => foldText(char));
  const starts: number[] = [];
  let joined = '';
  for (const part of folded) {
    starts.push(joined.length);
    joined += part;
  }
  const marked = chars.map(() => false);
  for (const word of words) {
    const at = joined.indexOf(word);
    if (at === -1) continue;
    starts.forEach((start, index) => {
      if (start < at + word.length && start + (folded[index]?.length ?? 0) > at) marked[index] = true;
    });
  }
  const nodes: Node[] = [];
  let from = 0;
  for (let index = 1; index <= chars.length; index += 1) {
    if (index < chars.length && marked[index] === marked[from]) continue;
    const text = chars.slice(from, index).join('');
    nodes.push(marked[from] ? node('mark', 'catalogue-authors__match', text) : document.createTextNode(text));
    from = index;
  }
  return nodes;
}

/**
 * The Author filter: a pill like the other facets whose popover lists the most prolific authors, then
 * everyone by name, or the matches of a typed name. A popover in the top layer, as the dropdowns are.
 */
export function authorPicker(onPick: (author: string | null) => void): AuthorPicker {
  const text = messages().mapCatalogue;
  const label = text.filterLabels.author;
  const root = node('div', 'main-menu__dropdown catalogue-pill is-any');
  const caption = node('span', 'catalogue-pill__caption', label);
  const button = node('button', 'main-menu__dropdown-btn');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', label);
  const value = node('span', 'main-menu__dropdown-btn-label');
  button.append(value);
  const clear = node('button', 'catalogue-pill__clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', formatMessage(text.clearFilter, { filter: label }));
  clear.addEventListener('click', () => onPick(null));
  const popover = node('div', 'main-menu__dropdown-list catalogue-authors');
  popover.popover = 'manual';
  popover.setAttribute(FIELD_KEYS_ATTRIBUTE, '');
  const search = quietTextField(node('input', 'catalogue-authors__search'));
  search.type = 'search';
  search.placeholder = text.authorSearch;
  search.setAttribute('aria-label', text.authorSearch);
  const list = node('div', 'catalogue-authors__list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  popover.append(search, list);
  root.append(caption, button, clear, popover);

  let authors: readonly AuthorCount[] = [];
  let active: string | null = null;

  const isOpen = (): boolean => popover.matches(':popover-open');
  const close = (): void => {
    if (isOpen()) popover.hidePopover();
  };
  const options = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];

  const option = (name: string | null, count: number | null, words: readonly string[]): HTMLButtonElement => {
    const element = node('button', 'main-menu__dropdown-option catalogue-authors__option');
    element.type = 'button';
    element.setAttribute('role', 'option');
    element.setAttribute('aria-selected', String(name === active));
    const nameSpan = node('span', 'main-menu__dropdown-option-label');
    nameSpan.append(
      ...(name === null ? [document.createTextNode(text.anyAuthor)] : highlighted(name, words)),
    );
    element.append(nameSpan);
    if (count !== null) element.append(node('span', 'main-menu__dropdown-option-detail', formatCount(count)));
    element.addEventListener('click', () => {
      close();
      button.focus({ preventScroll: true });
      if (name !== active) onPick(name);
    });
    return element;
  };

  const group = (heading: string, className: string, children: readonly HTMLElement[]): HTMLElement => {
    const box = node('div', `main-menu__dropdown-group ${className}`);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', heading);
    const items = node('div', 'catalogue-authors__items');
    items.append(...children);
    box.append(node('div', 'main-menu__dropdown-group-label', heading), items);
    return box;
  };

  const paintList = (): void => {
    const words = searchWords(search.value);
    const listing = authorListing(authors, search.value, compareLabels());
    if (listing.kind === 'matches') {
      list.replaceChildren(
        ...(listing.matches.length === 0
          ? [node('p', 'catalogue-authors__none', text.authorNone)]
          : listing.matches.map((author) => option(author.name, author.count, words))),
      );
      return;
    }
    list.replaceChildren(
      ...(listing.top.length > 0
        ? [
            group(
              text.authorTop,
              'is-top',
              listing.top.map((author) => option(author.name, author.count, [])),
            ),
          ]
        : []),
      group(text.authorAll, 'is-all', [
        option(null, null, []),
        ...listing.all.map((author) => option(author.name, author.count, [])),
      ]),
    );
  };

  const place = (): void => {
    const anchor = root.getBoundingClientRect();
    popover.style.maxHeight = '';
    const below = window.innerHeight - anchor.bottom - 2 * POPOVER_GAP_PX;
    const above = anchor.top - 2 * POPOVER_GAP_PX;
    const downward = popover.offsetHeight <= below || below >= above;
    popover.style.maxHeight = `${Math.min(popover.offsetHeight, downward ? below : above)}px`;
    const top = downward
      ? anchor.bottom + POPOVER_GAP_PX
      : anchor.top - POPOVER_GAP_PX - popover.offsetHeight;
    const left = Math.min(anchor.left, window.innerWidth - popover.offsetWidth - POPOVER_GAP_PX);
    popover.style.top = `${Math.max(POPOVER_GAP_PX, top)}px`;
    popover.style.left = `${Math.max(POPOVER_GAP_PX, left)}px`;
  };
  const onPressOutside = (event: PointerEvent): void => {
    if (!(event.target instanceof Node && root.contains(event.target))) close();
  };
  const onScroll = (event: Event): void => {
    if (!(event.target instanceof Node && popover.contains(event.target))) close();
  };
  popover.addEventListener('toggle', (event) => {
    const opened = event.newState === 'open';
    button.setAttribute('aria-expanded', String(opened));
    if (opened) {
      document.addEventListener('pointerdown', onPressOutside, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', close);
      return;
    }
    document.removeEventListener('pointerdown', onPressOutside, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
  });
  const open = (): void => {
    if (isOpen()) return;
    search.value = '';
    paintList();
    popover.showPopover();
    place();
    search.focus({ preventScroll: true });
  };
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  caption.addEventListener('click', () => button.click());
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open();
  });
  search.addEventListener('input', () => {
    paintList();
    place();
  });

  popover.addEventListener('keydown', (event) => {
    const all = options();
    const focused = document.activeElement;
    const at = focused instanceof HTMLButtonElement ? all.indexOf(focused) : -1;
    const focus = (target: HTMLButtonElement | undefined): void => {
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    };
    if (event.key === 'Escape') {
      close();
      button.focus({ preventScroll: true });
    } else if (event.key === 'ArrowDown') {
      focus(all[Math.min(all.length - 1, at + 1)]);
    } else if (event.key === 'ArrowUp') {
      if (at <= 0) search.focus({ preventScroll: true });
      else focus(all[at - 1]);
    } else if ((event.key === 'Home' || event.key === 'End') && at !== -1) {
      focus(event.key === 'Home' ? all[0] : all.at(-1));
    } else if (event.key === 'Enter' && focused === search) {
      all[0]?.click();
    } else if (event.key === 'Tab') {
      close();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });

  return {
    root,
    setAuthors(next) {
      authors = next;
      if (isOpen()) paintList();
    },
    setActive(author) {
      active = author;
      value.textContent = author ?? text.anyAuthor;
      root.classList.toggle('is-any', author === null);
      root.classList.toggle('is-set', author !== null);
      clear.hidden = author === null;
    },
  };
}
