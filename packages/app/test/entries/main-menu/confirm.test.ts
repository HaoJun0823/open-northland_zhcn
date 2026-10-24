// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { menuConfirm } from '../../../src/entries/main-menu/confirm.js';

const COPY = { title: 'Delete', message: 'Delete save “A”?', confirm: 'Delete', cancel: 'Cancel' };
const menuListeners: ((event: KeyboardEvent) => void)[] = [];
afterEach(() => {
  for (const listener of menuListeners.splice(0)) window.removeEventListener('keydown', listener);
  document.body.replaceChildren();
});

function setup() {
  const menu = document.createElement('div');
  menu.className = 'main-menu';
  const trigger = document.createElement('button');
  menu.append(trigger);
  document.body.append(menu);
  trigger.focus();
  const menuKeys = vi.fn();
  window.addEventListener('keydown', menuKeys);
  menuListeners.push(menuKeys);
  const buttons = (): HTMLButtonElement[] => [
    ...menu.querySelectorAll<HTMLButtonElement>('.main-menu__dialog button'),
  ];
  return { menu, trigger, menuKeys, buttons };
}

const press = (key: string): void => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

it('asks inside the menu root, declines on Escape and keeps the key from the menu', async () => {
  const h = setup();
  const answer = menuConfirm(h.trigger, COPY);
  expect(h.menu.querySelector('.main-menu__dialog-title')?.textContent).toBe(COPY.title);
  expect(document.activeElement).toBe(h.buttons()[0]);
  press('Escape');
  await expect(answer).resolves.toBe(false);
  expect(h.menuKeys).not.toHaveBeenCalled();
  expect(h.menu.querySelector('.main-menu__dialog')).toBeNull();
  expect(document.activeElement).toBe(h.trigger);
});

it('moves Tab between its two buttons and confirms with the accent one', async () => {
  const h = setup();
  const answer = menuConfirm(h.trigger, COPY);
  const [cancel, accept] = h.buttons();
  press('Tab');
  expect(document.activeElement).toBe(accept);
  press('Tab');
  expect(document.activeElement).toBe(cancel);
  accept?.click();
  await expect(answer).resolves.toBe(true);
});
