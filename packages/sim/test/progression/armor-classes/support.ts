import { type ContentSet, parseContentSet } from '@open-northland/data';
import { TEST_MANIFEST } from '../../fixtures/content.js';

/** The minimal non-armor scaffolding `parseContentSet` requires (goods/jobs/buildings). */
export const SCAFFOLD = {
  manifest: TEST_MANIFEST,
  goods: [{ typeId: 0, id: 'none' }],
  jobs: [{ typeId: 0, id: 'idle' }],
  buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' as const }],
};

/** Four records shaped like the base `armortypes.ini`: two light (`mainType` 1) and two heavy (2), declared
 *  out of class order so a grouping must keep source order within each bucket. */
export function armorContent(): ContentSet {
  return parseContentSet({
    ...SCAFFOLD,
    armor: [
      { typeId: 1, id: 'cloth', mainType: 1, materialType: 1 }, // light, tier 1
      { typeId: 3, id: 'chain', mainType: 2, materialType: 3 }, // heavy (declared before the other light row), tier 3
      { typeId: 2, id: 'leather', mainType: 1, materialType: 2 }, // light, tier 2
      { typeId: 4, id: 'plate', mainType: 2, materialType: 4 }, // heavy, tier 4
    ],
  });
}
