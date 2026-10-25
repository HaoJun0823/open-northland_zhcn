// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createHoldSection } from '../../../../src/hud/dom/vehicle-panel/hold.js';
import { warmVehicleModel } from '../../../../src/hud/dom/vehicle-panel/warm-model.js';

afterEach(() => document.body.replaceChildren());

it('replaces warm-up cargo icons when the first selected cart carries different goods', () => {
  const warm = warmVehicleModel(['water', 'mud', 'stone']);
  const water = { goodType: 1, goodId: 'water', label: 'Water', current: 5, wanted: 0, reserved: 5 };
  const model = {
    ...warm,
    entityId: 42,
    hold: {
      slots: 30,
      rows: [water],
      goods: [{ ...water, category: 0 }],
      routed: false,
      cargoHand: true,
      hauled: false,
    },
  };
  const unused = (): never => {
    throw new Error('unexpected vehicle action');
  };
  const section = createHoldSection(
    {
      icons: (frame, id) => {
        frame.style.backgroundImage = `url("/${id}.png")`;
      },
      cue: unused,
      vehicle: {
        order: unused,
        setStance: unused,
        seatRider: unused,
        leave: unused,
        unloadPeople: unused,
        loadVehicle: unused,
        unloadVehicle: unused,
        setWanted: unused,
        clearWanted: unused,
      },
    },
    () => model,
  );
  document.body.append(section.element);
  section.update(warm);
  section.update(model);
  const row = section.element.querySelector('.on-cargo-row');
  expect(row?.querySelector('.on-cargo-row__name')?.textContent).toBe('Water');
  expect(row?.querySelector<HTMLElement>('.on-good__frame')?.style.backgroundImage).toBe('url("/water.png")');
});
