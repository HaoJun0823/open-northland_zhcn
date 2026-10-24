import { describe, expect, it } from 'vitest';
import { BUILDING_KIND, BuildingType } from '../src/index.js';

/**
 * `kind` accepts exactly the known classes plus the extractor's `maintype_<...>` degrade path. A
 * typo'd or renamed kind must fail at parse, not silently never match a caller's comparison.
 */
describe('BuildingType.kind', () => {
  const record = (kind: string): Record<string, unknown> => ({ typeId: 1, id: 'hq', kind });

  it('accepts every known class and the extractor fallback', () => {
    for (const kind of [...Object.values(BUILDING_KIND), 'maintype_9', 'maintype_unknown'])
      expect(BuildingType.parse(record(kind)).kind).toBe(kind);
  });

  it('rejects a misspelt, miscased or empty kind', () => {
    for (const kind of ['worplace', 'Home', '']) expect(() => BuildingType.parse(record(kind))).toThrow();
  });
});
