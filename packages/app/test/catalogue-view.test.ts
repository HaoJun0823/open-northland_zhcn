// @vitest-environment jsdom
import { catalogBrowseEntry } from '@open-northland/data';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as sources from '../src/content/map-source/index.js';
import { CARDS_PER_BATCH } from '../src/entries/main-menu/catalogue/card-batches.js';
import { catalogueView, initialCatalogueMemory } from '../src/entries/main-menu/catalogue/view.js';
import { catalogEntry } from './support/catalog-maps.js';

const entries = Array.from({ length: 40 }, (_, i) => catalogEntry(`cn-${String(i).padStart(2, '0')}`));
const disposals: (() => void)[] = [];
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(sources, 'installedMapStore').mockReturnValue(null);
  vi.spyOn(sources, 'loadMapSources').mockResolvedValue([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/catalog') return Response.json(entries.map(catalogBrowseEntry));
      const entry = entries.find((entry) => path === `/v1/maps/${entry.id}`);
      return entry === undefined ? new Response(null, { status: 404 }) : Response.json(entry);
    }),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mounted() {
  const memory = initialCatalogueMemory();
  const view = catalogueView({ memory, purpose: 'play', onPick: () => {} });
  disposals.push(view.dispose);
  document.body.append(view.tabs, view.body);
  await settle();
  return { view, memory, grid: view.body.querySelector('.catalogue__grid') as HTMLElement };
}
it('yields between card batches and preserves keyboard selection of a card not yet rendered', async () => {
  const { grid, memory } = await mounted();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  expect(grid.getAttribute('aria-busy')).toBe('true');
  const first = grid.firstElementChild as HTMLElement;
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(memory.selectedId).toBe('cn-39');
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(entries.length);
  expect(grid.getAttribute('aria-busy')).toBe('false');
  expect(document.activeElement?.getAttribute('data-entry-id')).toBe('cn-39');
  expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
});
it('cancels obsolete query batches and stops rendering after disposal', async () => {
  const { view, grid } = await mounted();
  const input = view.body.querySelector('input[type="search"]') as HTMLInputElement;
  input.value = 'cn-39';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.runAllTimersAsync();
  expect([...grid.children].map((node) => node.getAttribute('data-entry-id'))).toEqual(['cn-39']);
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  view.dispose();
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
});
it('ignores detail responses arriving after another entry is selected', async () => {
  let resolveFirst = (_response: Response) => {};
  const fetchEntry = vi.spyOn(sources, 'fetchCatalogEntry').mockImplementation(async (_api, id) => {
    if (id === 'cn-00')
      return new Promise((resolve) => {
        resolveFirst = async (response) => resolve(await response.json());
      });
    const entry = entries.find((entry) => entry.id === id);
    return entry ?? null;
  });
  const { view, grid } = await mounted();
  (grid.children[1] as HTMLElement).click();
  await settle();
  resolveFirst(Response.json({ ...entries[0], title: 'Obsolete title' }));
  await settle();
  expect(view.body.querySelector('.catalogue-detail__title')?.textContent).toBe('cn-01');
  (grid.firstElementChild as HTMLElement).click();
  await settle();
  expect(fetchEntry.mock.calls.filter(([, id]) => id === 'cn-00')).toHaveLength(2);
});
it('retries a failed detail load when the selected card is opened again', async () => {
  const fetchEntry = vi
    .spyOn(sources, 'fetchCatalogEntry')
    .mockRejectedValueOnce(new Error('detail temporarily unavailable'))
    .mockResolvedValue(entries[0] ?? null);
  const { view, grid } = await mounted();
  expect(view.body.querySelector('.catalogue-detail__status')?.textContent).toBe(
    'detail temporarily unavailable',
  );
  (grid.firstElementChild as HTMLElement).click();
  await settle();
  expect(fetchEntry).toHaveBeenCalledTimes(2);
  expect(view.body.querySelector('.catalogue-detail__status')?.textContent).not.toBe(
    'detail temporarily unavailable',
  );
});
it('cancels remaining browse batches when switching to the installed tab', async () => {
  const { view, grid } = await mounted();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  (view.tabs.children[1] as HTMLElement).click();
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  expect(grid.getAttribute('aria-busy')).toBe('false');
});
