import { describe, expect, it } from 'vitest';
import { excludeStringTableCopies, findMapFolders, mapIdFromPath } from '../src/folders.js';
import { treeOf } from './support/folder.js';

describe('mapIdFromPath', () => {
  it('slugs the containing folder name (lower-case, non-alphanumerics -> _)', () => {
    expect(mapIdFromPath('CnModMaps/tutorial_002/map.cif')).toBe('tutorial_002');
    expect(mapIdFromPath('CnModMaps/SPECJALNA- FORTECA/map.cif')).toBe('specjalna_forteca');
  });
  it('folds accented letters the same way whichever normalization the file system stored', () => {
    expect(mapIdFromPath('CnModMaps/Kraina Starych Bohater\u00f3w/map.cif')).toBe('kraina_starych_bohaterow');
    expect(mapIdFromPath('CnModMaps/Kraina Starych Bohatero\u0301w/map.cif')).toBe(
      'kraina_starych_bohaterow',
    );
    expect(mapIdFromPath('CnModMaps/Magiczny_Las \u2014 12 players/map.cif')).toBe('magiczny_las_12_players');
  });

  it('accepts either separator', () => {
    expect(mapIdFromPath('CnModMaps/Zgielk2/map.cif')).toBe('zgielk2');
    expect(mapIdFromPath('CnModMaps\\Zgielk2\\map.cif')).toBe('zgielk2');
  });
});

describe('excludeStringTableCopies', () => {
  it('drops a candidate in a Text/ subfolder of another candidate folder (case-folded)', () => {
    const map = { rel: 'CnModMaps/WICHRY_ZIMY/map.dat', path: '/m' };
    const stray = { rel: 'CnModMaps/WICHRY_ZIMY/Text/map.dat', path: '/s' };
    expect(excludeStringTableCopies([map, stray])).toEqual([map]);
  });

  it('keeps a top-level map folder that happens to be named text', () => {
    const map = { rel: 'CnModMaps/text/map.dat', path: '/m' };
    expect(excludeStringTableCopies([map])).toEqual([map]);
  });
});

describe('findMapFolders', () => {
  it('lists every map.dat folder in spelled-path order, the root as an empty key', () => {
    const tree = treeOf({
      'Pack/Main/map.dat': '',
      'Pack/Main_SUB1/MAP.DAT': '',
      'Pack/Main/text/map.dat': '',
      'Pack/Main/map.ini': '',
      'map.dat': '',
    });
    expect(findMapFolders(tree)).toEqual(['pack/main', 'pack/main_sub1', '']);
  });
});
