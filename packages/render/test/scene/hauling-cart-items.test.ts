import { describe, expect, it } from 'vitest';
import { buildSpriteScene } from '../../src/data/scene/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * A posted carrier pulling the hauling cart it has taken draws as the cart's driving figure: its settler
 * item takes the cart's type and names itself as the driver, the way a cart's commander does. One still
 * walking to the cart, or one whose cart is gone, draws as itself.
 */

const HANDCART = 1;
const CARRIER = 24;
const VIKING = 1;
const PLAYER = 2;
const PORTER = 1;
const CART = 2;

function porter(held: { vehicle: number; taken: boolean } | undefined) {
  return entity(PORTER, 4, 2, {
    Settler: { tribe: VIKING, jobType: CARRIER },
    Owner: { player: PLAYER },
    ...(held === undefined ? {} : { HaulingCart: held }),
  });
}

/** The taken cart: off the map, so no `Position`. */
function takenCart() {
  return {
    id: CART,
    components: {
      Vehicle: { vehicleType: HANDCART, tribe: VIKING, hauler: PORTER, passengers: [null], vehicles: [] },
      Owner: { player: PLAYER },
    },
  };
}

describe('a carrier pulling its hauling cart', () => {
  it("draws as the taken cart's driving figure", () => {
    const items = buildSpriteScene(snapshotOf([porter({ vehicle: CART, taken: true }), takenCart()]));
    const item = items.find((i) => i.ref === PORTER);
    expect(item).toMatchObject({
      kind: 'settler',
      typeId: HANDCART,
      driver: { ref: PORTER, jobType: CARRIER, tribe: VIKING },
    });
    expect(items.some((i) => i.ref === CART)).toBe(false);
  });

  it('draws as itself while it still walks to the cart', () => {
    const [item] = buildSpriteScene(snapshotOf([porter({ vehicle: CART, taken: false })]));
    expect(item?.driver).toBeUndefined();
    expect(item?.typeId).toBeUndefined();
  });

  it('draws as itself when the cart it holds is gone', () => {
    const [item] = buildSpriteScene(snapshotOf([porter({ vehicle: CART, taken: true })]));
    expect(item?.driver).toBeUndefined();
  });
});
