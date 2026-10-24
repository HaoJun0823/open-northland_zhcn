import { describe, expect, it } from 'vitest';
import { parseMapsIndex } from '../../../src/content/map/maps-index.js';
import { TINY_FINGERPRINT } from '../../support/catalog-maps.js';

/**
 * The menu reads `maps-index.json` through the shared schema. The pipeline that wrote the listing is
 * the same build, so a document that does not parse is stale content: the list stays empty instead of
 * showing a guessed subset.
 */
describe('parseMapsIndex', () => {
  const arena = {
    id: 'arena',
    fingerprint: TINY_FINGERPRINT,
    provenance: { kind: 'mod', folder: 'maps/community/arena' },
    name: { pol: 'Arena', eng: 'Arena' },
    description: { eng: 'Two against two.' },
    picture: true,
    minimap: true,
    players: [
      {
        player: 0,
        type: 'human',
        tribeId: 1,
        colorId: 7,
        name: { pol: 'Ragnar' },
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
      {
        player: 1,
        type: 'ai',
        tribeId: 4,
        colorId: 9,
        claimable: false,
        hidden: true,
        aiAllowed: false,
        noneAllowed: true,
        hasComputerControl: true,
      },
    ],
    fixedColors: true,
    mapTypes: [4, 6],
    multiplayerOnly: true,
  };

  it('keeps a well-formed listing, optional fields included', () => {
    const listing = [arena, { id: 'bare', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false }];
    expect(parseMapsIndex(listing)).toEqual(listing);
  });

  it('reads an absent listing as no maps', () => {
    expect(parseMapsIndex(null)).toEqual([]);
  });

  it('reads a listing this build cannot parse as no maps', () => {
    expect(parseMapsIndex({ maps: [arena] })).toEqual([]);
    expect(parseMapsIndex([{ ...arena, provenance: { kind: 'mod', folder: '../escape' } }])).toEqual([]);
    expect(parseMapsIndex([{ ...arena, players: [{ player: 0, type: 'robot' }] }])).toEqual([]);
    expect(parseMapsIndex([{ ...arena, mapTypes: 'yes' }])).toEqual([]);
    expect(parseMapsIndex([{ ...arena, fingerprint: 'short' }])).toEqual([]);
  });
});
