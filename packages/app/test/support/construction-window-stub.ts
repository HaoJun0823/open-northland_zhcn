import type { ConstructionWindow } from '../../src/hud/dom/construction-window.js';
import type { ConstructionWindowSeam } from '../../src/hud/tool-panel/windows.js';

/** A construction window without a DOM: the registry's open, close, suspend and resume plumbing,
 *  with the seam the registry handed it kept for a test to press its buttons. */
export interface ConstructionWindowStub extends ConstructionWindow {
  readonly seam: ConstructionWindowSeam;
  /** The stock models `update` received. */
  readonly models: unknown[];
}

export function stubConstructionWindow(seam: ConstructionWindowSeam): ConstructionWindowStub {
  let open = false;
  let suspended = false;
  const models: unknown[] = [];
  const stub: ConstructionWindowStub = {
    seam,
    models,
    isOpen: () => open,
    toggle: () => {
      open = !open;
      if (!open) suspended = false;
    },
    close: () => {
      open = false;
      suspended = false;
    },
    place: () => undefined,
    update: (model) => {
      models.push(model);
    },
    suspend: () => {
      if (!open) return;
      open = false;
      suspended = true;
    },
    resume: () => {
      if (!suspended) return;
      suspended = false;
      open = true;
    },
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
  return stub;
}
