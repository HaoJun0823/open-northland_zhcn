import type { SubMissionTransition } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { createHudPlane, HUD_DOM_Z } from './root.js';
import { holdHudKeys, openSystemDialog, systemDialogBody, systemDialogButton } from './system-confirm.js';

export interface SubMissionWindow {
  /** The handover failed: offer a retry, and staying on this map when the world is still there. */
  failed(retry: () => void, stay?: () => void): void;
  dispose(): void;
}

/** The note that holds the paused game while a map script hands over to its sub-mission or back to the
 *  parent map. It cannot be dismissed: the handover either leaves this map or fails into a choice. It has
 *  its own plane above the game's, since a handover that fails late does so after the game and its HUD
 *  were torn down. */
export function openSubMissionWindow(scale: number, kind: SubMissionTransition['kind']): SubMissionWindow {
  const copy = messages().subMission;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: String(HUD_DOM_Z + 1) });
  const plane = createHudPlane(scale);
  host.append(plane.element);
  document.body.append(host);
  const dialog = openSystemDialog(plane.element, kind === 'end' ? copy.returnTitle : copy.title, copy.stay);
  dialog.frame.element.querySelector('.on-window__close')?.remove();
  const { message, actions } = systemDialogBody(dialog.frame, copy.loading);
  message.setAttribute('role', 'status');
  actions.hidden = true;
  const release = holdHudKeys(
    plane.element,
    () => [...actions.querySelectorAll('button')],
    () => {},
  );
  dialog.frame.open();
  let open = true;
  const dispose = (): void => {
    if (!open) return;
    open = false;
    release();
    dialog.close();
    host.remove();
  };
  return {
    failed(retry, stay) {
      message.textContent = copy.failed;
      const choose = (then: () => void) => () => {
        dispose();
        then();
      };
      const again = systemDialogButton(copy.retry, choose(retry));
      actions.replaceChildren(
        ...(stay === undefined ? [] : [systemDialogButton(copy.stay, choose(stay))]),
        again,
      );
      actions.hidden = false;
      again.focus();
    },
    dispose,
  };
}
