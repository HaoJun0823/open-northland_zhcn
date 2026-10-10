import type { CatalogEntry } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { INSTALLED_MAP_RECORD_VERSION, type InstalledMapRecord } from '../src/content/map-source/index.js';
import {
  canDownload,
  catalogueRow,
  filterCatalogueRows,
  languageCodes,
  mainCatalogMap,
} from '../src/entries/main-menu/catalogue/model.js';
import { catalogEntry, TINY_FINGERPRINT } from './support/catalog-maps.js';

const IR = 9;

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
    index: { id: mapId, picture: false, minimap: false, provenance: { kind: 'catalog', folder: entryId } },
    installedAt: 1,
    size: 1,
    suffixes: ['.json'],
  };
}

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

  it('shows a campaign by its main map and counts the sub maps', () => {
    const row = catalogueRow(converted('cn-pack', ['cn-pack-2', 'cn-pack', 'cn-pack-3']), [], IR);
    expect(row.main?.mapId).toBe('cn-pack-2');
    expect(row.subMapCount).toBe(2);
    const entry = converted('cn-pack', ['a', 'b']);
    if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
    const allSub = entry.conversion.maps.map((map) => ({
      ...map,
      index: { ...map.index, campaign: { campaignId: 1, missionId: 1 } },
    }));
    expect(mainCatalogMap(allSub)?.mapId).toBe('a');
    const played = catalogueRow(entry, [installed('a', 'cn-pack'), installed('b', 'cn-pack')], IR);
    expect(played.playableMapId).toBe('a');
  });

  it('filters by category tab and searches title and author', () => {
    const rows = [
      catalogueRow({ ...converted('b'), title: 'Bitwa', category: 'series-multi' }, [], IR),
      catalogueRow({ ...converted('a'), title: 'Atak', author: 'Zenon', category: 'single' }, [], IR),
    ];
    expect(filterCatalogueRows(rows, 'all', '').map((row) => row.entry.id)).toEqual(['a', 'b']);
    expect(filterCatalogueRows(rows, 'series', '').map((row) => row.entry.id)).toEqual(['b']);
    expect(filterCatalogueRows(rows, 'all', 'zen').map((row) => row.entry.id)).toEqual(['a']);
    expect(languageCodes(['pol', 'eng'])).toBe('PL, EN');
  });
});
