import { MapMeta, MapProvenance } from '@open-northland/data';
import { expect, it } from 'vitest';
import { mapProvenance, takesSourceLanguageOverlays } from '../../../src/stages/maps/provenance.js';

it.each([
  ['UserMaps/example', 'user'],
  ['maps/community/example', 'mod'],
  ['extras/maps/example', 'mod'],
  ['Data/maps/example', 'unknown'],
])('classifies the mod-root folder %s conservatively', (folder, kind) => {
  const rel = `${folder}/map.dat`;
  expect(mapProvenance(rel)).toEqual({ kind, folder });
});

it('reads a hand-edited sidecar without provenance and rejects unsafe provenance folders', () => {
  expect(MapMeta.parse({ name: { eng: 'Edited' } }).provenance).toBeUndefined();
  for (const folder of ['/absolute', '../escape', 'C:/install', 'Data\\maps', 'a//b', './map']) {
    expect(MapProvenance.safeParse({ kind: 'unknown', folder }).success).toBe(false);
  }
});

it.each([
  ['maps/community/example', true],
  ['UserMaps/example', true],
  ['Data/maps/example', false],
  ['maps/community/tutorial_001', false],
  ['Maps/Community/Tutorial_007/', false],
  ['maps/community/tutorial_009', true],
])('lets a source-language overlay edit %s: %s', (folder, takes) => {
  expect(takesSourceLanguageOverlays(folder)).toBe(takes);
});
