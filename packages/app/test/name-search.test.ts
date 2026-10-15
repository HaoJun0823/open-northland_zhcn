import { expect, it } from 'vitest';
import { nameHasWords } from '../src/hud/dom/parts/name-search.js';

it('finds every typed word anywhere in the name, in any order, folded', () => {
  expect(nameHasWords('Wieża obronna 1', 'obronn')).toBe(true);
  expect(nameHasWords('Wieża obronna 1', 'OBRONNA  wiez')).toBe(true);
  expect(nameHasWords('Warszt. ciesielski 3', 'ciesiel 3')).toBe(true);
  expect(nameHasWords('Świątynia', 'swiat')).toBe(true);
  expect(nameHasWords('Warszt. ciesielski 3', 'ciesiel 2')).toBe(false);
});

it('keeps every name for an empty or blank query', () => {
  expect(nameHasWords('Magazyn', '')).toBe(true);
  expect(nameHasWords('Magazyn', '   ')).toBe(true);
});
