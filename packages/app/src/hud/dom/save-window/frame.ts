import { messages } from '../../../i18n/index.js';
import type { SaveLoadSession } from '../../../view/runtime/save-load/index.js';
import { createTooltip } from '../../../view/tooltip.js';
import { GLYPH } from '../icons.js';
import { button, element } from '../parts/dom.js';
import { attachTipLayer } from '../parts/tip-layer.js';
import type { SystemConfirmCopy } from '../system-confirm.js';
import { createHudWindow, type HudWindow } from '../window.js';

export interface SaveWindowDeps {
  readonly plane: HTMLElement;
  readonly saveLoad: SaveLoadSession;
  readonly confirm: (copy: SystemConfirmCopy) => Promise<boolean>;
  readonly signal: AbortSignal;
  /** Back to the menu's root buttons. */
  readonly onBack: () => void;
  /** The close medallion: leave the menu altogether. */
  readonly onClose: () => void;
}

/** A page of the system menu, shown in place of its root. */
export interface MenuPageView {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
}

export interface SavesFrame {
  readonly window: HudWindow;
  /** Right of the status line: the window's own actions, the primary last. */
  readonly actions: HTMLElement;
  /** Left of the status line, after Back. */
  readonly leading: HTMLElement;
  readonly status: (text: string | null) => void;
  /** Hides a pending tooltip; the window is closing or its rows are redrawn. */
  readonly hideTips: () => void;
}

/** The frame both save windows share: the menu's dialog window, a footer with Back, a live status line
 *  that keeps its height empty so a message never moves the buttons, and the tooltips of its icons. */
export function savesFrame(deps: SaveWindowDeps, title: string, modifier: string): SavesFrame {
  const copy = messages();
  const window = createHudWindow(deps.plane, {
    title,
    closeLabel: copy.hud.systemMenuDetails.resume,
    width: 0,
    compact: true,
  });
  window.element.classList.add('on-system-dialog', 'on-saves', modifier);
  window.element.style.removeProperty('width');
  window.element.setAttribute('role', 'dialog');
  window.element.setAttribute('aria-modal', 'true');
  window.onDismiss(deps.onClose);

  const back = button('on-button', GLYPH.back);
  back.append(copy.saveList.back);
  back.addEventListener('click', deps.onBack);
  const leading = element('div', 'on-saves__leading');
  leading.append(back);
  const status = element('p', 'on-saves__status');
  status.setAttribute('role', 'status');
  const actions = element('div', 'on-saves__actions');
  const foot = element('div', 'on-saves__foot');
  foot.append(leading, status, actions);
  window.body.after(foot);

  const chip = createTooltip({ zIndex: 2001 });
  const tips = attachTipLayer(window.element, chip);
  deps.signal.addEventListener(
    'abort',
    () => {
      tips.dispose();
      chip.destroy();
    },
    { once: true },
  );
  return {
    window,
    actions,
    leading,
    status: (text) => {
      status.textContent = text ?? '';
    },
    hideTips: tips.hide,
  };
}

/** Paints pending work before a flow's synchronous half freezes the frame. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
