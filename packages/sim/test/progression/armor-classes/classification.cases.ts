import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { armorByClass } from '../../../src/systems/index.js';
import { armorContent, SCAFFOLD } from './support.js';

describe('armorByClass', () => {
  it('partitions the armor by class, grouping records that share one in source order', () => {
    const byClass = armorByClass(armorContent());
    // two classes among the four records: light=1 (cloth, leather), heavy=2 (chain, plate)
    expect([...byClass.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    // declared order is cloth, chain, leather, plate - so bucket 1 keeps cloth before leather,
    // bucket 2 keeps chain before plate (content.armor order, not re-sorted by typeId)
    expect(byClass.get(1)?.map((a) => a.id)).toEqual(['cloth', 'leather']);
    expect(byClass.get(2)?.map((a) => a.id)).toEqual(['chain', 'plate']);
  });

  it('omits a record with no mainType (no undefined bucket)', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [
        { typeId: 1, id: 'cloth', mainType: 1 },
        { typeId: 2, id: 'no_class' }, // no mainType - dropped, not bucketed under undefined
      ],
    });
    const byClass = armorByClass(content);
    expect([...byClass.keys()]).toEqual([1]);
    expect(byClass.get(1)?.map((a) => a.id)).toEqual(['cloth']);
  });
});
