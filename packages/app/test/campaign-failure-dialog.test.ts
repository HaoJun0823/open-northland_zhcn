// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { campaignFailureDialog } from '../src/campaign/failure-dialog.js';
import { messages } from '../src/i18n/index.js';

beforeEach(() => {
  // An open dialog renders its controls, so jsdom lets them take focus.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

function open() {
  const recovery = { retry: vi.fn(), continueWithoutSaving: vi.fn() };
  const scope = new AbortController();
  campaignFailureDialog(recovery, scope.signal);
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog');
  const button = (label: string): HTMLButtonElement => {
    const found = [...dialog.querySelectorAll('button')].find((b) => b.textContent === label);
    if (found === undefined) throw new Error(`no ${label}`);
    return found;
  };
  return { recovery, scope, dialog, button };
}

describe('campaign failure dialog', () => {
  it('focuses Retry and retries the same batch', () => {
    const { recovery, dialog, button } = open();
    expect(document.activeElement).toBe(button(messages().campaign.retry));
    button(messages().campaign.retry).click();
    expect(recovery.retry).toHaveBeenCalledOnce();
    expect(recovery.continueWithoutSaving).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);
  });

  it('continues without saving from its button', () => {
    const { recovery, dialog, button } = open();
    button(messages().campaign.continueWithoutSaving).click();
    expect(recovery.continueWithoutSaving).toHaveBeenCalledOnce();
    expect(dialog.isConnected).toBe(false);
  });

  it('reads Escape as continuing without saving', () => {
    const { recovery, dialog } = open();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(recovery.continueWithoutSaving).toHaveBeenCalledOnce();
    expect(recovery.retry).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);
  });

  it('closes without an answer when its game goes away', () => {
    const { recovery, scope, dialog } = open();
    scope.abort();
    expect(dialog.isConnected).toBe(false);
    expect(recovery.retry).not.toHaveBeenCalled();
    expect(recovery.continueWithoutSaving).not.toHaveBeenCalled();
  });
});
