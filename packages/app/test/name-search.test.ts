import { expect, it } from 'vitest';
import { foldText, hasWords, searchWords } from '../src/hud/dom/parts/name-search.js';

const found = (text: string, query: string): boolean => hasWords(text, searchWords(query));

it('folds case and Polish letters', () => {
  expect(foldText('Łódź Żółw')).toBe('lodz zolw');
  expect(searchWords('  OBRONNA  wieź ')).toEqual(['obronna', 'wiez']);
});

it('finds every typed word anywhere in the text, in any order', () => {
  expect(found('Wieża obronna 1', 'obronn')).toBe(true);
  expect(found('Wieża obronna 1', 'obronna wiez')).toBe(true);
  expect(found('Warszt. ciesielski 3', 'ciesiel 3')).toBe(true);
  expect(found('Świątynia', 'swiat')).toBe(true);
  expect(found('Warszt. ciesielski 3', 'ciesiel 2')).toBe(false);
});

it('keeps a word inside one field of several joined by a line break', () => {
  expect(found('Arne\nPiekarz', 'piekarz arne')).toBe(true);
  expect(found('Arne\nPiekarz', 'nepie')).toBe(false);
});

it('keeps every text for a blank query', () => {
  expect(found('Magazyn', '')).toBe(true);
  expect(found('Magazyn', '   ')).toBe(true);
});
