// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignFailureDialog } from '../src/campaign/failure-dialog.js';
import { messages } from '../src/i18n/index.js';

afterEach(() => {
  document.body.replaceChildren();
});

function open() {
  const plane = document.createElement('div');
  const panel = document.createElement('button');
  plane.append(panel);
  document.body.append(plane);
  const recovery = { retry: vi.fn(), continueWithoutSaving: vi.fn() };
  const scope = new AbortController();
  campaignFailureDialog(plane, recovery, scope.signal);
  const dialog = plane.querySelector('.on-system-confirm');
  if (dialog === null) throw new Error('no dialog');
  const button = (label: string): HTMLButtonElement => {
    const found = [...dialog.querySelectorAll('.on-system-confirm__actions button')].find(
      (b) => b.textContent === label,
    );
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${label}`);
    return found;
  };
  return { recovery, scope, dialog, panel, button };
}

const press = (key: string): void => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

describe('campaign failure dialog', () => {
  it('focuses Retry, leaves the HUD inert and retries the same batch', () => {
    const { recovery, dialog, panel, button } = open();
    expect(panel.inert).toBe(true);
    expect(document.activeElement).toBe(button(messages().campaign.retry));
    button(messages().campaign.retry).click();
    expect(recovery.retry).toHaveBeenCalledOnce();
    expect(recovery.continueWithoutSaving).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);
    expect(panel.inert).toBeFalsy();
  });

  it('continues without saving from its button', () => {
    const { recovery, dialog, button } = open();
    button(messages().campaign.continueWithoutSaving).click();
    expect(recovery.continueWithoutSaving).toHaveBeenCalledOnce();
    expect(dialog.isConnected).toBe(false);
  });

  it('reads Escape as continuing without saving', () => {
    const { recovery, dialog } = open();
    press('Escape');
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
