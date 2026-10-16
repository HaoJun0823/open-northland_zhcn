import { components } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { StorageMinimumModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { createCounter } from '../parts/counter.js';
import { element, setHidden, setTip, write } from '../parts/dom.js';
import type { BuildingPanelDeps } from './actions.js';

/** Design px of the good's icon in its well (foundation.css `.on-good-well`). */
const MINIMUM_ICON_PX = 18;
/** What one arrow press moves a minimum by; the tens key moves it by ten. */
const MINIMUM_STEP = 5;

export interface MinimumGood {
  readonly goodType: number;
  readonly goodId: string | undefined;
  readonly label: string;
}

/** The storage-minimum line under a house's stock: the good it sets and a −/n/+ counter, or the hint to
 *  pick a good while a storehouse has none picked. */
export interface MinimumRow {
  readonly element: HTMLElement;
  update(model: StorageMinimumModel, good: MinimumGood | null): void;
}

export function createMinimumRow(deps: BuildingPanelDeps): MinimumRow {
  const root = element(
    'div',
    'on-ledger on-ledger--ctl on-building-minimum',
    `<span class="on-building-minimum__label"></span><span class="on-good-well">${goodIconMarkup(MINIMUM_ICON_PX)}</span><span class="on-building-minimum__good"></span><small class="on-building-minimum__hint"></small>`,
  );
  const label = root.querySelector('.on-building-minimum__label');
  const well = root.querySelector('.on-good-well');
  const frame = root.querySelector('.on-good__frame');
  const name = root.querySelector('.on-building-minimum__good');
  const hint = root.querySelector('.on-building-minimum__hint');
  if (
    !(label instanceof HTMLElement) ||
    !(well instanceof HTMLElement) ||
    !(frame instanceof HTMLElement) ||
    !(name instanceof HTMLElement) ||
    !(hint instanceof HTMLElement)
  ) {
    throw new Error('building panel: minimum row');
  }
  let shown: { model: StorageMinimumModel; good: MinimumGood } | null = null;
  const counter = createCounter({ max: components.STORAGE_MINIMUM_MAX, step: MINIMUM_STEP }, (next) => {
    if (shown === null || shown.model.control !== true) return;
    deps.building.setStorageMinimum(shown.model.player, shown.good.goodType, next);
  });
  root.append(counter.element);
  let icon = '';

  return {
    element: root,
    update(model, good): void {
      const copy = messages().hud.buildingPanel;
      shown = good === null ? null : { model, good };
      write(label, copy.minimum);
      setTip(label, copy.minimumTooltip);
      setHidden(well, good === null);
      setHidden(name, good === null);
      setHidden(counter.element, good === null);
      setHidden(hint, good !== null);
      if (good === null) {
        write(hint, copy.minimumPick);
        return;
      }
      if (good.goodId !== undefined && good.goodId !== icon) {
        icon = good.goodId;
        frame.removeAttribute('style');
        deps.icons(frame, good.goodId, MINIMUM_ICON_PX);
      }
      write(name, good.label);
      const value = model.minimums[good.goodType] ?? 0;
      const control = model.control;
      const reason = control === true ? null : control;
      counter.update({
        value,
        lessLabel: formatMessage(copy.minimumLess, { good: good.label }),
        moreLabel: formatMessage(copy.minimumMore, { good: good.label }),
        lessTooltip: reason ?? formatMessage(copy.minimumLess, { good: good.label }),
        moreTooltip: reason ?? formatMessage(copy.minimumMore, { good: good.label }),
        lessEnabled: control === true && value > 0,
        moreEnabled: control === true && value < components.STORAGE_MINIMUM_MAX,
      });
    },
  };
}
