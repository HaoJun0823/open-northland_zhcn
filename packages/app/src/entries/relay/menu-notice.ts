import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import { type BootNoticeAction, mountBootNotice } from '../../view/boot-progress.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';
import type { KeptSeat } from './seat-surrender.js';

/** The notice a relayed entry ends on, with a way back to the menu that takes the notice with it. */
export function mountReturnToMenuNotice(title: string, detail: string): void {
  mountHaltNotice(title, detail, { onCard: false, seat: null });
}

export interface HaltNoticeOptions {
  /** Said on the loading card's backdrop, for a game that never showed its world. */
  readonly onCard: boolean;
  /** The seat the relay still holds for this client; the notice then offers Retry and Leave. */
  readonly seat: KeptSeat | null;
}

/** The notice a relayed game halts on. Without a kept seat its one way out is the menu. */
export function mountHaltNotice(title: string, detail: string, options: HaltNoticeOptions): void {
  const copy = messages();
  const { seat } = options;
  let remove = (): void => undefined;
  let leaving = false;
  const toMenu = (): void => void swapToEntry(menuSearch(), remove);
  const actions: readonly BootNoticeAction[] =
    seat === null
      ? [{ label: copy.hud.returnToMenu, onClick: toMenu }]
      : [
          {
            label: copy.networkRelay.retry,
            onClick: () => {
              if (!leaving) seat.retry();
            },
          },
          {
            label: copy.networkRelay.leaveGame,
            onClick: () => {
              if (leaving) return;
              leaving = true;
              void seat.leave().finally(toMenu);
            },
          },
        ];
  const text = seat === null ? detail : formatMessage(copy.networkRelay.seatKept, { reason: detail });
  if (options.onCard) {
    remove = mountBootNotice(title, text, actions);
    return;
  }
  const buttons = actions.map((action) => {
    const button = el('button', BUTTON_STYLE, action.label);
    button.type = 'button';
    button.addEventListener('click', action.onClick);
    return button;
  });
  remove = mountMessage(title, text, buttons);
}
