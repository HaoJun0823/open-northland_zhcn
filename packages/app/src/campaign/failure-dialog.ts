import {
  holdHudKeys,
  openSystemDialog,
  systemDialogBody,
  systemDialogButton,
} from '../hud/dom/system/confirm.js';
import { messages } from '../i18n/index.js';
import type { CampaignFailureRecovery } from './runtime.js';

/**
 * The HUD system window a failed campaign progress write opens. Retry has focus; Escape and the window's
 * close continue without saving, so blocked storage never holds the game paused.
 */
export function campaignFailureDialog(
  plane: HTMLElement,
  recovery: CampaignFailureRecovery,
  signal: AbortSignal,
): void {
  if (signal.aborted) return;
  const copy = messages().campaign;
  const dialog = openSystemDialog(plane, copy.title, copy.continueWithoutSaving);
  const { actions } = systemDialogBody(dialog.frame, copy.storage);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    release();
    signal.removeEventListener('abort', close);
    dialog.close();
  };
  const choose = (action: () => void) => (): void => {
    close();
    action();
  };
  const continueWithoutSaving = choose(recovery.continueWithoutSaving);
  const release = holdHudKeys(plane, () => [...actions.querySelectorAll('button')], continueWithoutSaving);
  const skip = systemDialogButton(copy.continueWithoutSaving, continueWithoutSaving);
  const retry = systemDialogButton(copy.retry, choose(recovery.retry));
  actions.append(skip, retry);
  dialog.frame.onDismiss(continueWithoutSaving);
  signal.addEventListener('abort', close, { once: true });
  dialog.frame.open();
  retry.focus();
}
