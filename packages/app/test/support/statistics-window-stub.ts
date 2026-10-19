import type { HudModel } from '@open-northland/render';
import type { StatisticsWindow } from '../../src/hud/dom/statistics-window.js';

/** A statistics window without a DOM, which keeps the models the registry hands it. */
export interface StatisticsWindowStub extends StatisticsWindow {
  readonly models: HudModel[];
}

export function stubStatisticsWindow(): StatisticsWindowStub {
  let open = false;
  const models: HudModel[] = [];
  return {
    models,
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    update: (model) => {
      models.push(model);
    },
    place: () => undefined,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
