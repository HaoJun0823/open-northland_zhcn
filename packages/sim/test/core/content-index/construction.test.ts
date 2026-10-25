import { describe, expect, it } from 'vitest';
import { upgradeBills } from '../../../src/core/content-index/construction.js';
import { testContent } from '../../fixtures/content.js';

const STONE = 1;
const WOOD = 2;
const HOME_L0 = 900;
const HOME_L1 = 901;
const HOME_L2 = 902;
const HOME_L3 = 903;

function chain() {
  const first = testContent().buildings[0];
  if (first === undefined) throw new Error('fixture must contain a building');
  const { upgradeTarget: _, ...base } = first;
  const tier = (
    typeId: number,
    construction: { goodType: number; amount: number }[],
    upgradeTarget?: number,
  ) => ({
    ...base,
    typeId,
    id: `home_${typeId}`,
    construction,
    ...(upgradeTarget === undefined ? {} : { upgradeTarget }),
  });
  return [
    tier(HOME_L0, [{ goodType: WOOD, amount: 1 }], HOME_L1),
    tier(HOME_L1, [{ goodType: WOOD, amount: 2 }], HOME_L2),
    tier(
      HOME_L2,
      [
        { goodType: STONE, amount: 3 },
        { goodType: WOOD, amount: 4 },
      ],
      HOME_L3,
    ),
    tier(HOME_L3, [{ goodType: STONE, amount: 5 }]),
  ];
}

describe('upgradeBills', () => {
  it('sums each good over every raised tier, leaving out the tier the building stands at', () => {
    const fromL0 = upgradeBills(chain()).get(HOME_L0);
    expect(fromL0?.get(HOME_L1)).toEqual([{ goodType: WOOD, amount: 2 }]);
    expect(fromL0?.get(HOME_L2)).toEqual([
      { goodType: STONE, amount: 3 },
      { goodType: WOOD, amount: 6 },
    ]);
    expect(fromL0?.get(HOME_L3)).toEqual([
      { goodType: STONE, amount: 8 },
      { goodType: WOOD, amount: 6 },
    ]);
    expect(upgradeBills(chain()).get(HOME_L3)).toBeUndefined();
  });
});
