import type { CatalogConvertedMap, CatalogEntry, MapsIndexPlayerSlot } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { INSTALLED_MAP_RECORD_VERSION, type InstalledMapRecord } from '../src/content/map-source/index.js';
import { languageCodes } from '../src/entries/main-menu/catalogue/card.js';
import {
  type CatalogueRow,
  canDownload,
  catalogueRow,
  installedGroups,
  isReady,
  MEDIUM_MAP_MAX_CELLS,
  mainCatalogMap,
  mapSize,
  SMALL_MAP_MAX_CELLS,
  shippedMaps,
} from '../src/entries/main-menu/catalogue/model.js';
import {
  authorSuggestions,
  type CatalogueQuery,
  DEFAULT_CATALOGUE_QUERY,
  foldText,
  formatBytes,
  hasActiveFilters,
  queryRows,
} from '../src/entries/main-menu/catalogue/query.js';
import { catalogEntry, TINY_FINGERPRINT } from './support/catalog-maps.js';

const IR = 9;
const KIB = 1024;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function converted(id: string, mapIds: readonly string[] = [id], irVersion = IR): CatalogEntry {
  const entry = catalogEntry(id, mapIds);
  if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
  return { ...entry, conversion: { ...entry.conversion, irVersion } };
}

function installed(
  mapId: string,
  entryId: string,
  irVersion = IR,
  fingerprint = TINY_FINGERPRINT,
): InstalledMapRecord {
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    mapId,
    entryId,
    fingerprint,
    irVersion,
    index: {
      id: mapId,
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      provenance: { kind: 'catalog', folder: entryId },
    },
    installedAt: 1,
    size: KIB,
    suffixes: ['.json'],
  };
}

function seats(count: number): MapsIndexPlayerSlot[] {
  return Array.from({ length: count }, (_, player) => ({
    player,
    type: 'human',
    tribeId: 1,
    colorId: player,
    claimable: true,
    hidden: false,
    aiAllowed: true,
    noneAllowed: true,
    hasComputerControl: true,
  }));
}

/** A converted single-map entry with the map's seats, languages and size set. */
function mapEntry(
  id: string,
  overrides: Partial<CatalogEntry> = {},
  map: { players?: number; languages?: CatalogConvertedMap['languages']; side?: number } = {},
): CatalogEntry {
  const entry = converted(id);
  if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
  const [first] = entry.conversion.maps;
  if (first === undefined) throw new Error('fixture');
  const side = map.side ?? 1;
  const only: CatalogConvertedMap = {
    ...first,
    languages: map.languages ?? first.languages,
    cells: { width: side, height: side },
    index: { ...first.index, ...(map.players === undefined ? {} : { players: seats(map.players) }) },
  };
  return { ...entry, conversion: { ...entry.conversion, maps: [only] }, ...overrides };
}

const ids = (rows: readonly CatalogueRow[]): string[] => rows.map((row) => row.entry.id);
const rowsOf = (entries: readonly CatalogEntry[], records: readonly InstalledMapRecord[] = []) =>
  entries.map((entry) => catalogueRow(entry, records, IR));

describe('catalogue rows', () => {
  it("reads each entry's state from the server and the installed maps", () => {
    const status = (entry: CatalogEntry, records: InstalledMapRecord[] = []) =>
      catalogueRow(entry, records, IR).status;
    expect(
      status(
        catalogEntry('x', [], { file: { kind: 'external', url: 'https://x.test' }, conversion: undefined }),
      ),
    ).toBe('external');
    expect(status(catalogEntry('x', [], { conversion: undefined }))).toBe('pending');
    expect(status(catalogEntry('x', [], { conversion: { verdict: 'pending' } }))).toBe('pending');
    expect(
      status(catalogEntry('x', [], { conversion: { verdict: 'failed', reason: 'no-map', message: 'm' } })),
    ).toBe('failed');
    expect(status(converted('x', ['x'], IR + 1))).toBe('gameTooOld');
    expect(status(converted('x', ['x'], IR - 1))).toBe('serverTooOld');
    expect(status(converted('x'))).toBe('available');
    expect(status(converted('x'), [installed('x', 'x')])).toBe('installed');
    expect(status(converted('x'), [installed('x', 'x', IR, 'e'.repeat(64))])).toBe('updatable');
    expect(status(converted('x'), [installed('x', 'x', IR - 1)])).toBe('redownload');
    // Installed for this build, the map stays playable while the server re-converts it.
    expect(status(catalogEntry('x', [], { conversion: { verdict: 'pending' } }), [installed('x', 'x')])).toBe(
      'installed',
    );
    expect(canDownload('redownload') && canDownload('updatable') && !canDownload('pending')).toBe(true);
  });

  it('shows a pack by its main map, counts the rest and joins their seats and languages', () => {
    const entry = converted('cn-pack', ['cn-pack-2', 'cn-pack', 'cn-pack-3']);
    if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
    const [a, b, c] = entry.conversion.maps;
    if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
    const pack: CatalogEntry = {
      ...entry,
      conversion: {
        ...entry.conversion,
        maps: [
          {
            ...a,
            languages: ['ger'],
            cells: { width: 250, height: 250 },
            index: { ...a.index, players: seats(4) },
          },
          { ...b, languages: ['pol', 'eng'], index: { ...b.index, players: seats(2) } },
          { ...c, index: { ...c.index, players: seats(4) } },
        ],
      },
    };
    const row = catalogueRow(pack, [], IR);
    expect(row.mainIndex?.id).toBe('cn-pack-2');
    expect(row.subMapCount).toBe(2);
    expect(row.playerCounts).toEqual([2, 4]);
    expect(row.languages).toEqual(['pol', 'eng', 'ger']);
    expect(row.size).toBe('large');
    const allSub = entry.conversion.maps.map((map) => ({
      ...map,
      index: { ...map.index, campaign: { campaignId: 1, missionId: 1 } },
    }));
    expect(mainCatalogMap(allSub)?.mapId).toBe('cn-pack-2');
    const played = catalogueRow(
      converted('two', ['a', 'b']),
      [installed('a', 'two'), installed('b', 'two')],
      IR,
    );
    expect(played.playableMapId).toBe('a');
  });

  it('sizes a map by its cell area', () => {
    const side = (area: number) => Math.sqrt(area);
    expect(mapSize({ width: side(SMALL_MAP_MAX_CELLS), height: side(SMALL_MAP_MAX_CELLS) })).toBe('small');
    expect(mapSize({ width: side(SMALL_MAP_MAX_CELLS) + 1, height: side(SMALL_MAP_MAX_CELLS) })).toBe(
      'medium',
    );
    expect(mapSize({ width: side(MEDIUM_MAP_MAX_CELLS), height: side(MEDIUM_MAP_MAX_CELLS) })).toBe('medium');
    expect(mapSize({ width: side(MEDIUM_MAP_MAX_CELLS) + 1, height: side(MEDIUM_MAP_MAX_CELLS) })).toBe(
      'large',
    );
  });

  it('groups installed maps by entry, the newest install first, with the catalogue row when listed', () => {
    const records = [
      { ...installed('a', 'pack'), installedAt: 5 },
      { ...installed('b', 'pack'), installedAt: 6 },
      { ...installed('gone', 'gone'), installedAt: 9 },
    ];
    const groups = installedGroups(records, rowsOf([converted('pack', ['a', 'b'])], records));
    expect(groups.map((group) => [group.entryId, group.bytes, group.row?.status ?? null])).toEqual([
      ['gone', KIB, null],
      ['pack', 2 * KIB, 'installed'],
    ]);
  });
});

describe('catalogue rows against the shipped maps', () => {
  const OTHER = 'e'.repeat(64);
  const shippedRow = (id: string, fingerprint = TINY_FINGERPRINT) => ({
    id,
    fingerprint,
    picture: true,
    minimap: true,
    name: { pol: id.toUpperCase() },
  });
  const shipped = shippedMaps([shippedRow('wyspa'), shippedRow('glowna'), shippedRow('zmieniona', OTHER)]);
  /** A converted entry whose maps came from `folders`, each fingerprinted as the tiny map. */
  const fromFolders = (id: string, folders: readonly string[]): CatalogEntry => {
    const entry = converted(
      id,
      folders.map((folder) => `${id}-${folder}`),
    );
    if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
    const maps = entry.conversion.maps.map((map, i) => ({ ...map, folder: folders[i] ?? map.folder }));
    return { ...entry, conversion: { ...entry.conversion, maps } };
  };
  const row = (entry: CatalogEntry, records: InstalledMapRecord[] = []) =>
    catalogueRow(entry, records, IR, shipped);

  it('plays a map the game ships in the same version from the shipped copy', () => {
    const same = row(fromFolders('cn-wyspa', ['wyspa']));
    expect(same.status).toBe('inGame');
    expect(same.playableMapId).toBe('wyspa');
    expect(same.playableIndex?.id).toBe('wyspa');
    expect(same.shipped).toMatchObject({ index: { id: 'wyspa' }, sameVersion: true });
    expect(canDownload(same.status)).toBe(false);
    expect(isReady(same)).toBe(true);
  });

  it('offers the catalogue copy of a shipped map in another version, or of a partly shipped pack', () => {
    const changed = row(fromFolders('cn-zmieniona', ['zmieniona']));
    expect(changed.status).toBe('inGameChanged');
    expect(changed.playableMapId).toBeNull();
    expect(changed.shipped).toMatchObject({ index: { id: 'zmieniona' }, sameVersion: false });
    expect(canDownload(changed.status)).toBe(true);
    const partly = row(fromFolders('cn-pack', ['glowna', 'glowna_sub1']));
    expect(partly.status).toBe('inGameChanged');
    expect(partly.shipped).toMatchObject({ index: { id: 'glowna' }, sameVersion: true });
    const whole = row(fromFolders('cn-two', ['wyspa', 'glowna']));
    expect(whole.status).toBe('inGame');
  });

  it('keeps the states of an installed copy and of a map the game does not ship', () => {
    const entry = fromFolders('cn-wyspa', ['wyspa']);
    expect(row(entry, [installed('cn-wyspa-wyspa', 'cn-wyspa')]).status).toBe('installed');
    expect(row(entry, [installed('cn-wyspa-wyspa', 'cn-wyspa', IR - 1)]).status).toBe('redownload');
    expect(row(fromFolders('cn-nowa', ['nowa'])).status).toBe('available');
    expect(row(converted('cn-wyspa', ['cn-wyspa-wyspa'], IR - 1)).status).toBe('serverTooOld');
  });

  it('filters by the two in-game states and keeps them out of installed and not installed', () => {
    const rows = [
      row(fromFolders('cn-wyspa', ['wyspa'])),
      row(fromFolders('cn-zmieniona', ['zmieniona'])),
      row(fromFolders('cn-nowa', ['nowa'])),
    ];
    const run = (state: CatalogueQuery['state']) =>
      ids(queryRows(rows, { ...DEFAULT_CATALOGUE_QUERY, sort: 'title', state }, compare));
    expect(run('inGame')).toEqual(['cn-wyspa']);
    expect(run('inGameChanged')).toEqual(['cn-zmieniona']);
    expect(run('installed')).toEqual([]);
    expect(run('notInstalled')).toEqual(['cn-nowa']);
  });
});

describe('catalogue query', () => {
  const entries = [
    mapEntry(
      'cn-burza',
      {
        title: 'Burza piaskowa',
        author: 'Żółw',
        kind: 'multi',
        likeCount: 30,
        downloadCount: 100,
        publishedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        fullDescription: 'Pustynia\nz oazami',
      },
      { players: 4, languages: ['pol', 'eng'], side: 250 },
    ),
    mapEntry(
      'cn-dolina',
      {
        title: 'Dolina',
        author: 'Ania',
        kind: 'single',
        series: true,
        likeCount: 30,
        downloadCount: 500,
        publishedAt: '2025-06-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
      { players: 1, languages: ['ger'], side: 100 },
    ),
    mapEntry(
      'cn-atak',
      {
        title: 'Atak',
        author: 'Bartek',
        kind: 'campaign',
        likeCount: 5,
        downloadCount: 900,
        publishedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        shortDescription: 'Obrona twierdzy',
      },
      { players: 2, languages: ['pol'], side: 180 },
    ),
    catalogEntry('cn-link', [], {
      title: 'Link',
      author: 'Ania',
      kind: 'other',
      categoryLabel: 'Narzędzia',
      file: { kind: 'external', url: 'https://example.test/map' },
      conversion: undefined,
    }),
    catalogEntry('cn-zepsuta', [], {
      title: 'Zepsuta',
      conversion: { verdict: 'failed', reason: 'decode-failed', message: 'm' },
    }),
  ];
  const rows = rowsOf(entries, [
    installed('cn-dolina', 'cn-dolina'),
    installed('cn-atak', 'cn-atak', IR, 'e'.repeat(64)),
  ]);
  const run = (patch: Partial<CatalogueQuery>) =>
    ids(queryRows(rows, { ...DEFAULT_CATALOGUE_QUERY, ...patch }, compare));

  it('orders by each sort, the most liked first by default', () => {
    expect(run({})).toEqual(['cn-dolina', 'cn-burza', 'cn-atak']);
    expect(run({ sort: 'downloaded' })).toEqual(['cn-atak', 'cn-dolina', 'cn-burza']);
    expect(run({ sort: 'newest' })).toEqual(['cn-atak', 'cn-dolina', 'cn-burza']);
    expect(run({ sort: 'updated' })).toEqual(['cn-burza', 'cn-atak', 'cn-dolina']);
    expect(run({ sort: 'title' })).toEqual(['cn-atak', 'cn-burza', 'cn-dolina']);
    expect(run({ sort: 'author' })).toEqual(['cn-dolina', 'cn-atak', 'cn-burza']);
  });

  it('hides external links and entries this build cannot have until asked', () => {
    expect(run({ readyOnly: false })).toEqual(['cn-dolina', 'cn-burza', 'cn-atak', 'cn-zepsuta']);
    expect(run({ readyOnly: false, showExternal: true })).toContain('cn-link');
    expect(run({ showExternal: true })).toEqual(['cn-dolina', 'cn-burza', 'cn-atak', 'cn-link']);
    expect(isReady(rows[4] as CatalogueRow)).toBe(false);
  });

  it('narrows by kind, series, seats, language, size, author and state', () => {
    expect(run({ kind: 'campaign' })).toEqual(['cn-atak']);
    expect(run({ kind: 'other', readyOnly: false, showExternal: true })).toEqual(['cn-link']);
    expect(run({ seriesOnly: true })).toEqual(['cn-dolina']);
    expect(run({ players: 4 })).toEqual(['cn-burza']);
    expect(run({ language: 'pol' })).toEqual(['cn-burza', 'cn-atak']);
    expect(run({ size: 'small' })).toEqual(['cn-dolina']);
    expect(run({ size: 'medium' })).toEqual(['cn-atak']);
    expect(run({ size: 'large' })).toEqual(['cn-burza']);
    expect(run({ author: 'zolw' })).toEqual(['cn-burza']);
    expect(run({ state: 'installed' })).toEqual(['cn-dolina', 'cn-atak']);
    expect(run({ state: 'update' })).toEqual(['cn-atak']);
    expect(run({ state: 'notInstalled' })).toEqual(['cn-burza']);
  });

  it('searches every word in title, author and both descriptions, without diacritics', () => {
    expect(run({ text: 'burza' })).toEqual(['cn-burza']);
    expect(run({ text: 'ZÓŁW' })).toEqual(['cn-burza']);
    expect(run({ text: 'oazami pustynia' })).toEqual(['cn-burza']);
    expect(run({ text: 'twierdzy' })).toEqual(['cn-atak']);
    expect(run({ text: 'twierdzy burza' })).toEqual([]);
    expect(foldText('Łódź Żółw')).toBe('lodz zolw');
  });

  it('counts only filters as active, not the search or the sort', () => {
    expect(hasActiveFilters(DEFAULT_CATALOGUE_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, text: 'x', sort: 'title' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, readyOnly: false })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, players: 2 })).toBe(true);
  });

  it('suggests matching authors, the most prolific first, until one is named exactly', () => {
    expect(authorSuggestions(rows, 'a')).toEqual(['Ania', 'Bartek']);
    expect(authorSuggestions(rows, 'an', 1)).toEqual(['Ania']);
    expect(authorSuggestions(rows, 'ania')).toEqual([]);
    expect(authorSuggestions(rows, ' ')).toEqual([]);
  });
});

describe('catalogue formatting', () => {
  it('names a byte count in the largest whole unit', () => {
    expect(formatBytes(512, 'en')).toBe('512 byte');
    expect(formatBytes(3 * KIB + KIB / 2, 'en')).toBe('3.5 kB');
    expect(formatBytes(5 * KIB * KIB, 'en')).toBe('5 MB');
    expect(formatBytes(5 * KIB * KIB, 'pl')).toBe('5 MB');
    expect(languageCodes(['pol', 'eng'])).toBe('PL EN');
  });
});
