import { dismissOnBackdropClick } from '../../view/backdrop-dismiss.js';
import { createHudWindow, type HudWindow } from './window.js';

export interface SystemConfirmCopy {
  readonly title: string;
  readonly message: string;
  readonly cancel: string;
  readonly confirm: string;
  /** Focus the confirm button: the player asked for the action, the question only stands before it. */
  readonly focusConfirm?: boolean;
}

export interface SystemDialog {
  readonly shade: HTMLElement;
  readonly frame: HudWindow;
  /** Removes the dialog, gives the plane's regions back and returns focus to what held it. */
  close(): void;
}

/** A centred system window over a shade that leaves the plane's other regions inert while it is open. */
export function openSystemDialog(plane: HTMLElement, title: string, closeLabel: string): SystemDialog {
  const prior = document.activeElement;
  const shade = document.createElement('div');
  shade.className = 'on-system-confirm';
  const inert = new Map<HTMLElement, boolean>();
  for (const child of plane.children) {
    if (child instanceof HTMLElement) {
      inert.set(child, child.inert);
      child.inert = true;
    }
  }
  plane.append(shade);
  const frame = createHudWindow(shade, { title, closeLabel, width: 420, compact: true });
  frame.element.classList.add('on-system-dialog');
  frame.element.setAttribute('role', 'alertdialog');
  frame.element.setAttribute('aria-modal', 'true');
  return {
    shade,
    frame,
    close() {
      shade.remove();
      for (const [element, prior] of inert) element.inert = prior;
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    },
  };
}

/** The dialog's message line and its action row, appended to the window body in that order. */
export function systemDialogBody(
  frame: HudWindow,
  text: string,
): { message: HTMLElement; actions: HTMLElement } {
  const message = document.createElement('p');
  message.className = 'on-system-confirm__message';
  message.textContent = text;
  const actions = document.createElement('div');
  actions.className = 'on-system-confirm__actions';
  frame.body.append(message, actions);
  return { message, actions };
}

export function systemDialogButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'on-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** The open holds, newest last; only the newest answers Tab and Escape. */
const keyHolds: object[] = [];

/**
 * Takes every key for a dialog over the game HUD, where no menu owns the keyboard, so none reaches the
 * game's bindings: Tab cycles `buttons`, Escape runs `onEscape`. Answers the release. The hold lets go
 * by itself once `plane` leaves the page, so a game torn down under an open dialog keeps no keys.
 */
export function holdHudKeys(
  plane: HTMLElement,
  buttons: () => readonly HTMLButtonElement[],
  onEscape: () => void,
): () => void {
  const hold = {};
  const release = (): void => {
    document.removeEventListener('keydown', onKey, true);
    const at = keyHolds.indexOf(hold);
    if (at >= 0) keyHolds.splice(at, 1);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!plane.isConnected) {
      release();
      return;
    }
    event.stopPropagation();
    if (keyHolds.at(-1) !== hold) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const list = buttons();
      const at = list.findIndex((button) => button.matches(':focus'));
      const next = event.shiftKey ? (at <= 0 ? list.length : at) - 1 : (at + 1) % list.length;
      list[next]?.focus();
    }
  };
  keyHolds.push(hold);
  document.addEventListener('keydown', onKey, true);
  return release;
}

/** A question above the current menu page. Cancelling restores that page and its focused control. */
export function createSystemConfirm(plane: HTMLElement) {
  let cancel: (() => void) | null = null;
  return {
    isOpen: (): boolean => cancel !== null,
    cancel: (): void => cancel?.(),
    open(copy: SystemConfirmCopy): Promise<boolean> {
      cancel?.();
      const dialog = openSystemDialog(plane, copy.title, copy.cancel);
      const { actions } = systemDialogBody(dialog.frame, copy.message);
      return new Promise<boolean>((resolve) => {
        const finish = (result: boolean): void => {
          cancel = null;
          dialog.close();
          resolve(result);
        };
        cancel = () => finish(false);
        dialog.frame.onDismiss(() => finish(false));
        dismissOnBackdropClick([dialog.shade], () => finish(false));
        const decline = systemDialogButton(copy.cancel, () => finish(false));
        const accept = systemDialogButton(copy.confirm, () => finish(true));
        actions.append(decline, accept);
        dialog.frame.open();
        (copy.focusConfirm === true ? accept : decline).focus();
      });
    },
  };
}

/** A system confirm over the game HUD; Escape declines. */
export function createHudConfirm(plane: HTMLElement): (copy: SystemConfirmCopy) => Promise<boolean> {
  const confirm = createSystemConfirm(plane);
  return (copy) => {
    // One hold per question: a question replacing an open one must not lose its keys when the
    // replaced one settles.
    const release = holdHudKeys(
      plane,
      () => [...plane.querySelectorAll<HTMLButtonElement>('.on-system-confirm button')],
      confirm.cancel,
    );
    return confirm.open(copy).finally(release);
  };
}
