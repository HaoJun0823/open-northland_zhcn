// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';
import type { BuildingPanelModel, UpgradeLevelModel } from '../../../../src/hud/details-panel/model/index.js';
import { createUpgradeLevels } from '../../../../src/hud/dom/building-panel/upgrade-levels.js';
import { warmBuildingModel } from '../../../../src/hud/dom/building-panel/warm-model.js';

const BUILDING = 7;
const tier = (typeId: number, level: number, control: true | string = true): UpgradeLevelModel => ({
  typeId,
  level,
  control,
  cost: [],
});

function modelWith(next: UpgradeLevelModel, further: readonly UpgradeLevelModel[]): BuildingPanelModel {
  const warm = warmBuildingModel([]);
  if (warm.orders === null) throw new Error('warm model has orders');
  return { ...warm, entityId: BUILDING, orders: { ...warm.orders, upgrade: { ...next, further } } };
}

function setup(model: BuildingPanelModel) {
  const upgrade = vi.fn();
  let current = model;
  const levels = createUpgradeLevels({ building: { upgrade } }, () => current);
  const slot = levels.slot(document.createElement('button'));
  const rail = slot.querySelector<HTMLElement>('.on-levels');
  const chips = (): HTMLButtonElement[] => [...slot.querySelectorAll<HTMLButtonElement>('.on-levels__chip')];
  const update = (next: BuildingPanelModel): void => {
    current = next;
    levels.update(next);
  };
  update(model);
  return { upgrade, rail, chips, update };
}

it('raises the building straight to the pressed level, and a refused level sends nothing', () => {
  const { upgrade, rail, chips } = setup(modelWith(tier(3, 2), [tier(4, 3), tier(5, 4, 'Wymaga kowala')]));
  expect(rail?.hidden).toBe(false);
  expect(chips().map((chip) => chip.textContent)).toEqual(['2', '3', '4']);
  chips()[1]?.click();
  chips()[2]?.click();
  expect(upgrade.mock.calls).toEqual([[BUILDING, 4]]);
});

it('keeps the rail down for a single tier and while Upgrade is refused', () => {
  const { rail, update } = setup(modelWith(tier(3, 2), []));
  expect(rail?.hidden).toBe(true);
  update(
    modelWith(tier(3, 2, 'Rozbudowa po ukończeniu budowy'), [tier(4, 3, 'Rozbudowa po ukończeniu budowy')]),
  );
  expect(rail?.hidden).toBe(true);
});
