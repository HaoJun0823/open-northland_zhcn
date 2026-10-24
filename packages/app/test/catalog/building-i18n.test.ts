import { describe, expect, it } from 'vitest';
import { localizedBuildingName, untranslatedBuildingIds } from '../../src/catalog/building-i18n.js';

describe('building name localization', () => {
  it('has a Polish name for every catalog building (no drift)', () => {
    expect(untranslatedBuildingIds('pol')).toEqual([]);
  });

  it('returns the Polish name for `pol` and keeps the English fallback otherwise', () => {
    // A known building resolves to its authored Polish name under `pol` …
    expect(localizedBuildingName('barracks', 'Barracks', 'pol')).toBe('Koszary');
    // … and to the English catalog label under an unlocalized language or an unknown id.
    expect(localizedBuildingName('barracks', 'Barracks', 'eng')).toBe('Barracks');
    expect(localizedBuildingName('unknown_id', 'Fallback', 'pol')).toBe('Fallback');
  });
});
