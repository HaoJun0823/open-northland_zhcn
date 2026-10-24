import { type ContentSet, parseContentSet, type VehicleType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { isShipVehicle } from '../../../../src/systems/index.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';

/** Resolve a vehicle by its `id` from a content set (throws if absent - a test-fixture programmer error). */
function vehicle(content: ContentSet, id: string): VehicleType {
  const found = content.vehicles.find((v) => v.id === id);
  if (found === undefined) throw new Error(`fixture has no vehicle "${id}"`);
  return found;
}

/**
 * `isShipVehicle` classifies a vehicle as a ship by the data alone (it carries passengers,
 * `passengerSlots > 0`), never by name. The fixture mirrors the real `vehicletypes.ini` rows: two
 * land carts and a catapult with no passenger slots, and two ships.
 */
function vehicleContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    vehicles: [
      // ship big (typeId 4) - a ship: passengerSlots > 0.
      // cargoGoods mirrors the real ships' full haulable-goods enumeration (sampled to a few ids here).
      {
        typeId: 4,
        id: 'ship_big',
        jobId: 53,
        hitpoints: 5000,
        stockSlots: 200,
        passengerSlots: 9,
        logicSize: 2,
        cargoGoods: [16, 17, 1],
      },
      // handcart (typeId 1) - a land cart: no passengers.
      {
        typeId: 1,
        id: 'handcart',
        jobId: 50,
        hitpoints: 1000,
        stockSlots: 15,
        passengerSlots: 0,
        logicSize: 0,
        cargoGoods: [16, 17],
      },
      {
        typeId: 3,
        id: 'ship_small',
        jobId: 52,
        hitpoints: 5000,
        stockSlots: 50,
        passengerSlots: 19,
        logicSize: 2,
        cargoGoods: [16, 17, 1],
      },
      // catapult (typeId 5) - a siege engine, NOT a ship: it carries no passengers (logicSize 1) or cargo.
      {
        typeId: 5,
        id: 'catapult',
        jobId: 54,
        hitpoints: 3000,
        stockSlots: 0,
        passengerSlots: 0,
        logicSize: 1,
      },
      // oxcart (typeId 2) - a land cart: no passengers.
      {
        typeId: 2,
        id: 'oxcart',
        jobId: 51,
        hitpoints: 1000,
        stockSlots: 30,
        passengerSlots: 0,
        logicSize: 0,
        cargoGoods: [16, 17],
      },
    ],
  });
}

describe('isShipVehicle', () => {
  it('is true for a vehicle that carries passengers (a ship) and false for a cart / catapult', () => {
    const content = vehicleContent();
    expect(isShipVehicle(vehicle(content, 'ship_small'))).toBe(true);
    expect(isShipVehicle(vehicle(content, 'ship_big'))).toBe(true);
    expect(isShipVehicle(vehicle(content, 'handcart'))).toBe(false); // a cart - no passengers
    expect(isShipVehicle(vehicle(content, 'oxcart'))).toBe(false);
    expect(isShipVehicle(vehicle(content, 'catapult'))).toBe(false); // siege engine - passengerSlots 0
  });
});
