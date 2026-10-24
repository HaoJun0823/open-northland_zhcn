import { catalogBrowseEntry, MAP_TYPE } from '@open-northland/data';
// @vitest-environment jsdom
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogFileUrl, catalogThumbnailUrl } from '../../../../src/content/map-source/index.js';
import {
  INSTALLED_MAP_RECORD_VERSION,
  type InstalledMapRecord,
} from '../../../../src/content/map-source/installed.js';
import { type CatalogueContext, catalogueCard } from '../../../../src/entries/main-menu/catalogue/card.js';
import { catalogueDetail } from '../../../../src/entries/main-menu/catalogue/detail.js';
import { installedPane } from '../../../../src/entries/main-menu/catalogue/installed.js';
import {
  type CatalogueRow,
  catalogueRows,
  installedGroups,
  shippedMaps,
} from '../../../../src/entries/main-menu/catalogue/model.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../../../../src/i18n/index.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';
import { mockCatalogue } from '../../../support/mock-catalogue-api.js';

const API = 'https://api.test';
const entries = mockCatalogue({ irVersion: IR_VERSION, contentDir: null }).entries;
const rows = catalogueRows(entries.map(catalogBrowseEntry), [], IR_VERSION);

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
  panel.show(
    row,
    false,
    entries.find((entry) => entry.id === entryId),
  );
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
    const shipped = shippedMaps([{ id: map.folder, fingerprint, picture: false, minimap: false }]);
    const row = catalogueRows(entries.map(catalogBrowseEntry), [], IR_VERSION, shipped).find(
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

function importedMap(n: number, sub = false): InstalledMapRecord {
  const mapId = `user-pack-${n}`;
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    revision: '00000000-0000-0000-0000-000000000001',
    mapId,
    entryId: 'user-pack',
    fingerprint: TINY_FINGERPRINT,
    irVersion: IR_VERSION,
    languages: ['pol'],
    index: {
      id: mapId,
      fingerprint: TINY_FINGERPRINT,
      name: { pol: `Mapa ${n}` },
      picture: false,
      minimap: false,
      provenance: { kind: 'user', folder: mapId },
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
      ...(sub ? { campaign: { campaignId: 0, missionId: n } } : {}),
    },
    installedAt: 1,
    size: 100,
    suffixes: ['.json'],
  };
}

it('lists three imported main maps separately and keeps ten sub-missions out of the picker and count', () => {
  const mains = [importedMap(1), importedMap(2), importedMap(3)];
  const subs = Array.from({ length: 10 }, (_, i) => importedMap(i + 4, true));
  const records = [...subs, ...mains];
  const pick = vi.fn();
  const rebuild = vi.fn();
  const pane = installedPane(ctx, { pick, rebuild });
  pane.paint(
    installedGroups(
      records,
      [],
      [
        {
          kind: 'local-source',
          version: 1,
          entryId: 'user-pack',
          name: 'pack.rar',
          fingerprint: TINY_FINGERPRINT,
          size: 500,
          maps: records.map((record) => ({ folder: record.mapId, mapId: record.mapId })),
        },
      ],
    ),
    null,
  );
  expect(pane.root.querySelector('h2')?.textContent).toBe('Zainstalowane (3)');
  expect([...pane.root.querySelectorAll('.catalogue-installed__title')].map((el) => el.textContent)).toEqual([
    'Mapa 1',
    'Mapa 2',
    'Mapa 3',
  ]);
  expect(pane.root.querySelector('select')).toBeNull();
  const play = [...pane.root.querySelectorAll<HTMLButtonElement>('.main-menu__primary')];
  for (const button of play) button.click();
  expect(pick.mock.calls.map(([record]) => record.mapId)).toEqual(mains.map((map) => map.mapId));
  expect(rebuild).not.toHaveBeenCalled();
  expect(pane.root.textContent).not.toContain(messages().mapCatalogue.localImport.stale);
});

it('hides campaign-only imports even without a campaign slot', () => {
  const map = importedMap(1);
  const pane = installedPane(ctx, { pick: vi.fn(), rebuild: vi.fn() });
  pane.paint(
    installedGroups([{ ...map, index: { ...map.index, mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN] } }], []),
    null,
  );
  expect(pane.root.querySelector('h2')?.textContent).toBe('Zainstalowane (0)');
  expect(pane.root.querySelector('.catalogue-installed__row')).toBeNull();
});

it('keeps a downloaded pack playable as one entry while its catalogue is unavailable', () => {
  const records = [importedMap(1), importedMap(2, true)].map(
    (record): InstalledMapRecord => ({
      ...record,
      index: { ...record.index, provenance: { kind: 'catalog', folder: 'pack' } },
    }),
  );
  const pick = vi.fn();
  const pane = installedPane(ctx, { pick, rebuild: vi.fn() });
  pane.paint(installedGroups(records, []), null);
  expect(pane.root.querySelectorAll('.catalogue-installed__row')).toHaveLength(1);
  pane.root.querySelector<HTMLButtonElement>('.main-menu__primary')?.click();
  expect(pick).toHaveBeenCalledWith(records[0]);
  expect(pane.root.querySelector('select')).toBeNull();
});
