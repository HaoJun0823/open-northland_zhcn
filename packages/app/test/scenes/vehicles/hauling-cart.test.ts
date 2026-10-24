import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { VEHICLE_HANDCART } from '../../../src/game/sandbox/index.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import {
  haulingCartScene,
  PARKED_CHECK_TICKS,
  SLEEP_ORDER_TICK,
} from '../../../src/scenes/vehicles/hauling-cart.js';
import { sceneAcceptance } from '../scene-case.js';

const { HaulingCart, Position, Vehicle, VehicleStock } = components;

sceneAcceptance(haulingCartScene, import.meta.url);

it('parks the handcart with its load for the ordered sleep, the end check proving it is taken up again', () => {
  const sim = createSceneSim(haulingCartScene);
  sim.run(SLEEP_ORDER_TICK + PARKED_CHECK_TICKS);
  // The ox cart porter may stand its cart beside a pile for a lift meanwhile; the sleeper's is the handcart.
  const sleepers = [...sim.world.query(HaulingCart)].filter(
    (e) => sim.world.get(sim.world.get(e, HaulingCart).vehicle, Vehicle).vehicleType === VEHICLE_HANDCART,
  );
  expect(sleepers).toHaveLength(1);
  const [porter] = sleepers;
  if (porter === undefined) throw new Error('unreachable');
  const held = sim.world.get(porter, HaulingCart);
  expect(held).toMatchObject({ taken: false, parked: true, lift: null });
  expect(sim.world.has(held.vehicle, Position)).toBe(true);
  const stowed = [...sim.world.get(held.vehicle, VehicleStock).lines.values()].reduce(
    (sum, line) => sum + line.current,
    0,
  );
  expect(stowed).toBeGreaterThan(0);
});
