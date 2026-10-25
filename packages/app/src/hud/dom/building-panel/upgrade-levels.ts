import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel, UpgradeLevelModel } from '../../details-panel/model/index.js';
import {
  button,
  element,
  setAttribute,
  setClass,
  setDisabled,
  setHidden,
  setTip,
  write,
} from '../parts/dom.js';
import type { BuildingPanelActions } from './actions.js';

/** The Upgrade tile in its grid place, and the level rail hung over it. */
export interface UpgradeLevels {
  /** Wraps the Upgrade tile so the rail shows while the pointer or the focus is on either. */
  slot(tile: HTMLElement): HTMLElement;
  update(model: BuildingPanelModel): void;
}

/**
 * The tiers a building can skip to, on a rail over its Upgrade tile: a press on a level raises the
 * building straight to it, while the tile itself keeps raising one tier. The rail exists only when a
 * tier past the next one does, and stays down while Upgrade is refused.
 */
export function createUpgradeLevels(
  deps: { readonly building: Pick<BuildingPanelActions, 'upgrade'> },
  current: () => BuildingPanelModel | null,
): UpgradeLevels {
  const slot = element('div', 'on-order-slot');
  const rail = element('div', 'on-levels');
  rail.setAttribute('role', 'group');
  const bar = element('div', 'on-levels__bar');
  const label = element('span', 'on-levels__label');
  bar.append(label);
  rail.append(bar);
  const chips: HTMLButtonElement[] = [];

  const levelsOf = (model: BuildingPanelModel | null): readonly UpgradeLevelModel[] => {
    const upgrade = model?.orders?.upgrade;
    return upgrade == null || upgrade.control !== true ? [] : [upgrade, ...upgrade.further];
  };
  const press = (index: number): void => {
    const shown = current();
    const level = levelsOf(shown)[index];
    if (shown === null || level === undefined || level.control !== true) return;
    deps.building.upgrade(shown.entityId, level.typeId);
  };

  return {
    slot(tile): HTMLElement {
      slot.replaceChildren(tile, rail);
      return slot;
    },
    update(model): void {
      const copy = messages().hud.buildingPanel;
      const levels = levelsOf(model);
      const offered = levels.length > 1;
      setHidden(rail, !offered);
      setClass(slot, 'on-order-slot--levels', offered);
      if (!offered) return;
      write(label, copy.upgradeLevels);
      setAttribute(rail, 'aria-label', copy.upgradeLevels);
      while (chips.length < levels.length) {
        const index = chips.length;
        const chip = button('on-levels__chip');
        chip.addEventListener('click', () => press(index));
        chips.push(chip);
        bar.append(chip);
      }
      chips.forEach((chip, index) => {
        const level = levels[index];
        setHidden(chip, level === undefined);
        if (level === undefined) return;
        write(chip, String(level.level));
        const cost = level.cost.map((line) => `${line.amount} ${line.label}`).join(', ');
        setTip(
          chip,
          level.control !== true
            ? level.control
            : cost === ''
              ? formatMessage(copy.upgradeTo, { level: level.level })
              : formatMessage(copy.upgradeToCost, { level: level.level, cost }),
        );
        setDisabled(chip, level.control !== true);
      });
    },
  };
}
