// @vitest-environment jsdom
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogFileUrl, catalogThumbnailUrl } from '../src/content/map-source/index.js';
import { type CatalogueContext, catalogueCard } from '../src/entries/main-menu/catalogue/card.js';
import { catalogueDetail } from '../src/entries/main-menu/catalogue/detail.js';
import { type CatalogueRow, catalogueRows, shippedMaps } from '../src/entries/main-menu/catalogue/model.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../src/i18n/index.js';
import { mockCatalogue } from './support/mock-catalogue-api.js';

const API = 'https://api.test';
const entries = mockCatalogue({ irVersion: IR_VERSION, contentDir: null }).entries;
const rows = catalogueRows(entries, [], IR_VERSION);

const ctx: CatalogueContext = {
  purpose: 'play',
  canStore: true,
  thumbnail: (entry) => catalogThumbnailUrl(API, entry),
  fileUrl: (entry) => catalogFileUrl(API, entry),
  progress: () => undefined,
  failure: () => undefined,
  download: () => {},
  remove: () => {},
  pick: () => {},
  open: () => {},
};

function rowOf(entryId: string): CatalogueRow {
  const row = rows.find((candidate) => candidate.entry.id === entryId);
  if (row === undefined) throw new Error(`${entryId} is not listed`);
  return row;
}

const card = (entryId: string, row = rowOf(entryId)) => catalogueCard(row, ctx, null).element;

function detail(
  entryId: string,
  row = rowOf(entryId),
  onAuthor: (author: string) => void = () => {},
): HTMLElement {
  const panel = catalogueDetail(ctx, API, onAuthor);
  panel.show(row, false);
  return panel.root;
}

const pageOf = (entryId: string) => `https://culturesnation.pl/downloads/doc-${entryId}/${entryId}`;
const statusOf = (root: HTMLElement) => root.querySelector('.catalogue-detail__status')?.textContent;
const badgeOf = (root: HTMLElement) => root.querySelector('.catalogue-badge');

const links = (root: HTMLElement) =>
  [...root.querySelectorAll('a')].map((link) => ({ text: link.textContent, href: link.href }));

let previousLocale = currentLocale();
beforeEach(() => {
  previousLocale = currentLocale();
  setActiveLocale('pol');
});
afterEach(() => setActiveLocale(previousLocale));

describe('catalogue entries the player downloads by hand', () => {
  const text = () => messages().mapCatalogue;

  it('never lists the archive that holds no map', () => {
    expect(rows.some((row) => row.entry.id === 'cn-norwegia')).toBe(false);
  });

  it('offers the kept file of an archive the server could not unpack, from the panel only', () => {
    const fileUrl = `${API}/v1/maps/cn-grobowiec/file`;
    const status = formatMessage(text().status.manual, { message: 'the rar archive is password-protected' });
    const element = card('cn-grobowiec');
    expect(badgeOf(element)?.textContent).toBe('Ręczne pobieranie');
    expect(badgeOf(element)?.getAttribute('title')).toBe(status);
    expect(links(element)).toEqual([]);
    expect(element.querySelector('button')).toBeNull();

    const panel = detail('cn-grobowiec');
    expect(statusOf(panel)).toBe(status);
    const actions = panel.querySelector('.catalogue-detail__actions') as HTMLElement;
    expect(links(actions)).toEqual([
      { text: 'Pobierz plik', href: fileUrl },
      { text: text().mapPage, href: pageOf('cn-grobowiec') },
    ]);
    expect(actions.querySelector('button')).toBeNull();
  });

  it('sends the player to the other site of an external entry, beside its own catalogue page', () => {
    expect(badgeOf(card('cn-gdzie-indziej'))?.textContent).toBe('Ręczne pobieranie');
    const panel = detail('cn-gdzie-indziej');
    expect(statusOf(panel)).toBe(text().status.external);
    expect(links(panel.querySelector('.catalogue-detail__actions') as HTMLElement)).toEqual([
      { text: text().openPage, href: 'https://example.org/some-map' },
      { text: text().mapPage, href: pageOf('cn-gdzie-indziej') },
    ]);
  });

  it('keeps a failed download without a kept file to its reason and its page', () => {
    expect(badgeOf(card('cn-zepsuta'))?.textContent).toBe(text().badges.failed);
    const actions = detail('cn-zepsuta').querySelector('.catalogue-detail__actions') as HTMLElement;
    expect(links(actions).map((link) => link.text)).toEqual([text().mapPage]);
    expect(actions.querySelector('.catalogue-detail__primary')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('catalogue maps the game already ships', () => {
  const text = () => messages().mapCatalogue;
  const downloadable = rows.find((row) => row.status === 'available' && row.maps.length === 1);
  if (downloadable === undefined) throw new Error('the mock lists no downloadable single map');
  const id = downloadable.entry.id;
  const [map] = downloadable.maps;
  if (map === undefined) throw new Error('fixture');
  const shippedRow = (fingerprint: string) => {
    const shipped = shippedMaps([{ ...map.index, id: map.folder, fingerprint }]);
    const row = catalogueRows(entries, [], IR_VERSION, shipped).find(
      (candidate) => candidate.entry.id === id,
    );
    if (row === undefined) throw new Error('fixture');
    return row;
  };

  it('names a same-version copy as already in the game and plays it', () => {
    const row = shippedRow(map.fingerprint);
    expect(row.status).toBe('inGame');
    expect(badgeOf(card(id, row))?.textContent).toBe('Już w grze');
    const panel = detail(id, row);
    expect(statusOf(panel)).toBe('Ta mapa jest już w grze. Nie trzeba jej pobierać.');
    expect(panel.querySelector('.catalogue-detail__primary button')?.textContent).toBe(text().play);
  });

  it('offers the catalogue version of a map the game ships in another version', () => {
    const row = shippedRow('f'.repeat(64));
    expect(row.status).toBe('inGameChanged');
    expect(badgeOf(card(id, row))?.textContent).toBe('Inna wersja w grze');
    const panel = detail(id, row);
    expect(statusOf(panel)).toBe(text().status.inGameChanged);
    expect(statusOf(panel)).toMatch(/^Gra ma inną wersję tej mapy/);
    expect(panel.querySelector('.catalogue-detail__primary button')?.textContent).toBe(
      'Pobierz wersję z katalogu',
    );
  });
});

describe('catalogue detail panel', () => {
  it('sets the author filter from the byline', () => {
    const picked: string[] = [];
    const row = rowOf('cn-grobowiec');
    const panel = detail('cn-grobowiec', row, (author) => picked.push(author));
    (panel.querySelector('.catalogue-detail__author') as HTMLButtonElement).click();
    expect(picked).toEqual([row.entry.author]);
  });

  it('shows the placeholder with its line and no entry once cleared', () => {
    const panel = catalogueDetail(ctx, API, () => {});
    panel.show(rowOf('cn-grobowiec'), false);
    panel.clear(messages().mapCatalogue.panelEmpty);
    expect(panel.shownId).toBeNull();
    expect(panel.root.classList.contains('is-empty')).toBe(true);
    expect(panel.root.querySelector('.catalogue-detail__empty')?.textContent).toBe('Brak map do pokazania');
  });
});
