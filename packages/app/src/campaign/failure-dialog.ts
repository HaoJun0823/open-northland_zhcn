import { messages } from '../i18n/index.js';
import { BUTTON_STYLE, DIALOG_STYLE, el } from '../view/overlay.js';
import type { CampaignFailureRecovery } from './runtime.js';

/** Retry has focus; Escape continues without saving, so blocked storage never holds the game paused. */
export function campaignFailureDialog(recovery: CampaignFailureRecovery, signal: AbortSignal): void {
  if (signal.aborted) return;
  const copy = messages().campaign;
  const dialog = el('dialog', `${DIALOG_STYLE};max-width:30rem`);
  dialog.append(el('p', 'line-height:1.5', copy.storage));
  const actions = el('div', 'display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap');
  const skip = el('button', BUTTON_STYLE, copy.continueWithoutSaving);
  const retry = el('button', BUTTON_STYLE, copy.retry);
  const dispose = (): void => {
    dialog.remove();
    signal.removeEventListener('abort', dispose);
  };
  const choose = (action: () => void) => (): void => {
    dispose();
    action();
  };
  const continueWithoutSaving = choose(recovery.continueWithoutSaving);
  retry.addEventListener('click', choose(recovery.retry));
  skip.addEventListener('click', continueWithoutSaving);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    continueWithoutSaving();
  });
  actions.append(skip, retry);
  dialog.append(actions);
  signal.addEventListener('abort', dispose, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  retry.focus();
}
