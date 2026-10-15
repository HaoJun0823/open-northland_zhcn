import { dismissOnBackdropClick } from '../../view/backdrop-dismiss.js';
import { createHudWindow } from './window.js';

export interface SystemConfirmCopy {
  readonly title: string;
  readonly message: string;
  readonly cancel: string;
  readonly confirm: string;
  /** Focus the confirm button: the player asked for the action, the question only stands before it. */
  readonly focusConfirm?: boolean;
}

/** A question above the current menu page. Cancelling restores that page and its focused control. */
export function createSystemConfirm(plane: HTMLElement) {
  let cancel: (() => void) | null = null;
  return {
    isOpen: (): boolean => cancel !== null,
    cancel: (): void => cancel?.(),
    open(copy: SystemConfirmCopy): Promise<boolean> {
      cancel?.();
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
      const frame = createHudWindow(shade, {
        title: copy.title,
        closeLabel: copy.cancel,
        width: 420,
        compact: true,
      });
      frame.element.classList.add('on-system-dialog');
      frame.element.setAttribute('role', 'alertdialog');
      frame.element.setAttribute('aria-modal', 'true');
      const message = document.createElement('p');
      message.className = 'on-system-confirm__message';
      message.textContent = copy.message;
      frame.body.append(message);
      return new Promise<boolean>((resolve) => {
        const finish = (result: boolean): void => {
          cancel = null;
          shade.remove();
          for (const [element, prior] of inert) element.inert = prior;
          if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
          resolve(result);
        };
        cancel = () => finish(false);
        frame.onDismiss(() => finish(false));
        dismissOnBackdropClick([shade], () => finish(false));
        const actions = document.createElement('div');
        actions.className = 'on-system-confirm__actions';
        for (const [label, result] of [
          [copy.cancel, false],
          [copy.confirm, true],
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'on-button';
          button.textContent = label;
          button.addEventListener('click', () => finish(result));
          actions.append(button);
        }
        frame.body.append(actions);
        frame.open();
        actions
          .querySelector<HTMLButtonElement>(copy.focusConfirm === true ? 'button:last-child' : 'button')
          ?.focus();
      });
    },
  };
}
