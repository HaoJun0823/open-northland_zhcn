import { node } from '../dom.js';
import { type CardDate, type CatalogueContext, catalogueCard } from './card.js';
import { renderCardBatches } from './card-batches.js';
import type { CatalogueRow } from './model.js';

/** Cards in the first rendered row: how far the Up and Down keys move. */
function gridColumns(cards: readonly HTMLElement[]): number {
  const top = cards[0]?.offsetTop;
  const nextRow = cards.findIndex((card) => card.offsetTop !== top);
  return Math.max(1, nextRow === -1 ? cards.length : nextRow);
}

/** Owns incremental card rendering and the grid's single keyboard tab stop. */
export function catalogueCardGrid(ctx: CatalogueContext, focusAction: () => void) {
  const root = node('div', 'catalogue__grid');
  const scroll = node('div', 'main-menu__map-scroll catalogue__scroll');
  scroll.append(root);
  const cards = new Map<
    string,
    ReturnType<typeof catalogueCard> & { readonly dateOf: CardDate; readonly row: CatalogueRow }
  >();
  let rows: readonly CatalogueRow[] = [];
  let selectedId: string | null = null;
  let focusWhenRendered: string | null = null;
  let cancelCards = () => {};

  function clear(): void {
    cancelCards();
    focusWhenRendered = null;
    root.style.minHeight = '';
    root.setAttribute('aria-busy', 'false');
  }

  function select(id: string | null): void {
    focusWhenRendered = null;
    selectedId = id;
    for (const [entryId, card] of cards) {
      const selected = entryId === id;
      card.element.classList.toggle('is-selected', selected);
      card.element.tabIndex = selected ? 0 : -1;
    }
  }

  function paint(shown: readonly CatalogueRow[], id: string | null, dateOf: CardDate): void {
    clear();
    rows = shown;
    selectedId = id;
    const current = new Set(shown.map((row) => row.entry.id));
    for (const entryId of cards.keys()) if (!current.has(entryId)) cards.delete(entryId);
    const scrollTop = scroll.scrollTop;
    root.style.minHeight = `${root.offsetHeight}px`;
    root.replaceChildren();
    scroll.scrollTop = scrollTop;
    root.setAttribute('aria-busy', 'true');
    cancelCards = renderCardBatches(shown, (batch, complete) => {
      const fragment = document.createDocumentFragment();
      for (const row of batch) {
        let card = cards.get(row.entry.id);
        if (card === undefined || card.dateOf !== dateOf || card.row !== row) {
          card = { ...catalogueCard(row, ctx, dateOf), dateOf, row };
          cards.set(row.entry.id, card);
        }
        const selected = row.entry.id === selectedId;
        card.element.classList.toggle('is-selected', selected);
        card.element.tabIndex = selected ? 0 : -1;
        fragment.append(card.element);
      }
      root.append(fragment);
      if (complete) root.style.minHeight = '';
      root.setAttribute('aria-busy', String(!complete));
      if (focusWhenRendered !== null) {
        const target = cards.get(focusWhenRendered)?.element;
        if (target?.parentElement === root) {
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'nearest' });
          focusWhenRendered = null;
        }
      }
    });
  }

  // Enter and Space focus the detail action; a single grid key press never downloads a map.
  root.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('catalogue-card')) return;
    const all = [...root.querySelectorAll<HTMLElement>('.catalogue-card')];
    const at = rows.findIndex((row) => row.entry.id === selectedId);
    const columns = gridColumns(all);
    const steps: Readonly<Record<string, number>> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      ArrowDown: at + columns,
      ArrowUp: at - columns,
      Home: 0,
      End: rows.length - 1,
    };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      focusAction();
      return;
    }
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const row = rows[Math.min(rows.length - 1, Math.max(0, next))];
    if (row === undefined) return;
    const id = row.entry.id;
    ctx.open(id);
    const card = cards.get(id)?.element;
    if (card?.parentElement !== root) {
      focusWhenRendered = id;
      return;
    }
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  });

  return {
    root,
    scroll,
    paint,
    select,
    clear,
    paintProgress: (entryId: string): void => cards.get(entryId)?.paintProgress(),
    dispose: clear,
  };
}
