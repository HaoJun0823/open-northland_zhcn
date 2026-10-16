// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { createHudConfirm } from '../src/hud/dom/system-confirm.js';

const COPY = { title: 'Demolish building', message: 'Demolish “Mill”?', cancel: 'Keep', confirm: 'Demolish' };

const gameListeners: ((event: KeyboardEvent) => void)[] = [];
afterEach(() => {
  for (const listener of gameListeners.splice(0)) window.removeEventListener('keydown', listener);
  document.body.replaceChildren();
});

function setup() {
  const plane = document.createElement('div');
  const panel = document.createElement('button');
  plane.append(panel);
  document.body.append(plane);
  panel.focus();
  const gameKeys = vi.fn();
  window.addEventListener('keydown', gameKeys);
  gameListeners.push(gameKeys);
  const buttons = (): HTMLButtonElement[] => [
    ...plane.querySelectorAll<HTMLButtonElement>('.on-system-confirm__actions button'),
  ];
  return { plane, panel, gameKeys, buttons, ask: createHudConfirm(plane) };
}

const press = (key: string, shiftKey = false): void => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
};

it('keeps the game from the keys, declines on Escape and gives focus back to the panel', async () => {
  const h = setup();
  const answer = h.ask(COPY);
  expect(h.panel.inert).toBe(true);
  expect(document.activeElement).toBe(h.buttons()[0]);
  press('a');
  press('Escape');
  await expect(answer).resolves.toBe(false);
  expect(h.gameKeys).not.toHaveBeenCalled();
  expect(h.plane.querySelector('.on-system-confirm')).toBeNull();
  expect(h.panel.inert).toBeFalsy();
  expect(document.activeElement).toBe(h.panel);
  press('a');
  expect(h.gameKeys).toHaveBeenCalledOnce();
});

it('cycles Tab through its own buttons and confirms with the confirm button', async () => {
  const h = setup();
  const answer = h.ask(COPY);
  const [keep, demolish] = h.buttons();
  press('Tab');
  expect(document.activeElement).toBe(demolish);
  press('Tab', true);
  expect(document.activeElement).toBe(keep);
  demolish?.click();
  await expect(answer).resolves.toBe(true);
});

it('keeps the keys for a question that replaced an open one', async () => {
  const h = setup();
  const first = h.ask(COPY);
  const second = h.ask(COPY);
  await expect(first).resolves.toBe(false);
  press('a');
  expect(h.gameKeys).not.toHaveBeenCalled();
  press('Escape');
  await expect(second).resolves.toBe(false);
});

it('lets go of the keys once the game under an open question is torn down', () => {
  const h = setup();
  void h.ask(COPY);
  h.plane.remove();
  press('a');
  press('a');
  expect(h.gameKeys).toHaveBeenCalledTimes(2);
});
