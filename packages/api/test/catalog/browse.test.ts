import { gunzipSync } from 'node:zlib';
import { CatalogBrowse, type CatalogConvertedMap, CatalogEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { expect, it } from 'vitest';
import { catalogSnapshot } from '../../src/catalog/snapshot.js';
import { catalogEntry } from '../support/conversion-fixture.js';

it('serves browse facts and searchable descriptions while retaining full indexes in detail', () => {
  const map: CatalogConvertedMap = {
    mapId: 'cn-pack',
    folder: 'island',
    fingerprint: 'a'.repeat(64),
    languages: ['eng'],
    cells: { width: 80, height: 250 },
    index: {
      id: 'cn-pack',
      fingerprint: 'a'.repeat(64),
      picture: false,
      minimap: false,
      description: { eng: 'Long installation description' },
      players: [false, true].map((hidden, player) => ({
        player,
        type: 'human',
        tribeId: 1,
        colorId: player,
        claimable: true,
        hidden,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: false,
      })),
    },
  };
  const entry: CatalogEntry = {
    ...catalogEntry('cn-pack'),
    shortDescription: 'Summary',
    fullDescription: 'Searchable desert',
    conversion: {
      verdict: 'ok',
      irVersion: IR_VERSION,
      maps: [
        { ...map, mapId: 'cn-sub', index: { ...map.index, campaign: { campaignId: 2, missionId: 1 } } },
        map,
      ],
    },
  };
  const snapshot = catalogSnapshot([entry], new Date(0));
  const browse = CatalogBrowse.parse(JSON.parse(snapshot.catalog.bytes.toString()))[0];
  expect(browse?.fullDescription).toBe(entry.fullDescription);
  expect(browse?.shortDescription).toBe(entry.shortDescription);
  expect(browse?.conversion).toMatchObject({
    mainMapId: map.mapId,
    maps: [
      { mapId: 'cn-sub', playerCount: 1 },
      { mapId: map.mapId, playerCount: 1 },
    ],
  });
  expect(snapshot.catalog.bytes.toString()).not.toContain('Long installation description');
  expect(snapshot.catalog.bytes.toString()).not.toContain('"index"');
  expect(CatalogEntry.parse(JSON.parse(snapshot.entries.get(entry.id)?.bytes.toString() ?? 'null'))).toEqual(
    entry,
  );
  expect(gunzipSync(snapshot.catalog.gzip?.bytes ?? Buffer.alloc(0))).toEqual(snapshot.catalog.bytes);
  expect(CatalogBrowse.safeParse([entry]).success).toBe(false);
});
