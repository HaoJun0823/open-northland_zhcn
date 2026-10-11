// @vitest-environment jsdom
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogFileUrl, catalogThumbnailUrl } from '../src/content/map-source/index.js';
import { type CatalogueContext, catalogueCard } from '../src/entries/main-menu/catalogue/card.js';
import { catalogueDetail } from '../src/entries/main-menu/catalogue/detail.js';
import { type CatalogueRow, catalogueRows } from '../src/entries/main-menu/catalogue/model.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../src/i18n/index.js';
import { mockCatalogue } from './support/mock-catalogue-api.js';

const API = 'https://api.test';
const rows = catalogueRows(
  mockCatalogue({ irVersion: IR_VERSION, contentDir: null }).entries,
  [],
  IR_VERSION,
);

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

const card = (entryId: string) => catalogueCard(rowOf(entryId), ctx, 'published').element;

function detail(entryId: string): HTMLElement {
  const panel = catalogueDetail(ctx, API, () => {});
  panel.show(rowOf(entryId), false);
  return panel.root;
}

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

  it('offers the kept file of an archive the server could not unpack', () => {
    const fileUrl = `${API}/v1/maps/cn-grobowiec/file`;
    const element = card('cn-grobowiec');
    expect(element.querySelector('.catalogue-badge')?.textContent).toBe('Pobierz ręcznie');
    expect(links(element)).toEqual([{ text: 'Pobierz plik', href: fileUrl }]);
    expect(element.querySelector('button')).toBeNull();

    const panel = detail('cn-grobowiec');
    expect(panel.querySelector('.catalogue-detail__status')?.textContent).toBe(
      formatMessage(text().status.manual, { message: 'the rar archive is password-protected' }),
    );
    const actions = panel.querySelector('.catalogue-detail__actions') as HTMLElement;
    expect(links(actions)).toContainEqual({ text: 'Pobierz plik', href: fileUrl });
    expect(actions.querySelector('button')).toBeNull();
  });

  it('sends the player to the other site of an external entry', () => {
    const element = card('cn-gdzie-indziej');
    expect(element.querySelector('.catalogue-badge')?.textContent).toBe('Pobierz ręcznie');
    expect(links(element)).toEqual([{ text: text().openPage, href: 'https://example.org/some-map' }]);
    const panel = detail('cn-gdzie-indziej');
    expect(panel.querySelector('.catalogue-detail__status')?.textContent).toBe(text().status.external);
  });

  it('keeps a failed download without a kept file to its reason alone', () => {
    const element = card('cn-zepsuta');
    expect(element.querySelector('.catalogue-badge')?.textContent).toBe(text().badges.failed);
    expect(links(element)).toEqual([]);
    const actions = detail('cn-zepsuta').querySelector('.catalogue-detail__actions') as HTMLElement;
    expect(links(actions).map((link) => link.text)).toEqual([text().cataloguePage]);
  });
});
