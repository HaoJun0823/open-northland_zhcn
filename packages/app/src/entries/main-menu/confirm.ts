import { dismissOnBackdropClick } from '../../view/backdrop-dismiss.js';

export interface MenuConfirmCopy {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
}

/**
 * The menu's modal question, mounted in the menu root around `anchor` so it reads the menu's tokens.
 * Escape, a backdrop click and the cancel button decline; cancel holds the focus, so Enter never
 * destroys by accident.
 */
export function menuConfirm(anchor: HTMLElement, copy: MenuConfirmCopy): Promise<boolean> {
  return new Promise((resolve) => {
    const shade = document.createElement('div');
    shade.className = 'main-menu__dialog-shade';
    const box = document.createElement('div');
    box.className = 'main-menu__dialog';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const title = document.createElement('h2');
    title.className = 'main-menu__dialog-title';
    title.textContent = copy.title;
    title.id = 'main-menu-dialog-title';
    box.setAttribute('aria-labelledby', title.id);
    const message = document.createElement('p');
    message.className = 'main-menu__dialog-message';
    message.textContent = copy.message;

    const prior = document.activeElement;
    const finish = (confirmed: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      shade.remove();
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
      resolve(confirmed);
    };
    // Capture phase, so the menu's own keys (Escape leaves the screen) stay behind the question.
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancel ? accept : cancel).focus();
      }
    };
    const button = (label: string, className: string, confirmed: boolean): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = className;
      el.textContent = label;
      el.addEventListener('click', () => finish(confirmed));
      return el;
    };
    const cancel = button(copy.cancel, 'main-menu__ghost', false);
    const accept = button(copy.confirm, 'main-menu__ghost is-accent', true);
    const actions = document.createElement('div');
    actions.className = 'main-menu__dialog-actions';
    actions.append(cancel, accept);

    box.append(title, message, actions);
    shade.append(box);
    dismissOnBackdropClick([shade], () => finish(false));
    document.addEventListener('keydown', onKey, true);
    (anchor.closest<HTMLElement>('.main-menu') ?? document.body).append(shade);
    cancel.focus();
  });
}
