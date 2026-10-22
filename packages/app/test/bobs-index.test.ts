import { describe, expect, it } from 'vitest';
import { parseBobsIndex } from '../src/entries/icons.js';

/** The `?icons` gallery reads `bobs-index.json` through the shared schema: a listing this build cannot
 *  read shows no gallery rather than rows with fields that read `undefined`. */
describe('parseBobsIndex', () => {
  it('keeps a well-formed listing, variant included when the stem carries one', () => {
    const listing = [
      {
        stem: 'ls_gui_window.iconsleft',
        image: '0123456789abcdef.webp',
        base: 'ls_gui_window',
        variant: 'iconsleft',
      },
      { stem: 'ls_goods', image: 'fedcba9876543210.webp', base: 'ls_goods', variant: '' },
    ];
    expect(parseBobsIndex(listing)).toEqual(listing);
  });

  it('reads a listing with a malformed row, or no listing, as no atlases at all', () => {
    expect(parseBobsIndex([{ stem: 'ls_houses_viking', image: 'a.webp', base: 7, variant: '' }])).toEqual([]);
    expect(parseBobsIndex([{ stem: 'ls_houses_viking', base: 'ls_houses_viking', variant: '' }])).toEqual([]);
    expect(parseBobsIndex(null)).toEqual([]);
    expect(parseBobsIndex({ stems: [] })).toEqual([]);
  });
});
