// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { openSubMissionWindow } from '../src/hud/dom/sub-mission-window.js';
import { createHudConfirm } from '../src/hud/dom/system-confirm.js';
import { messages } from '../src/i18n/index.js';

const copy = messages().subMission;
const gameListeners: ((event: KeyboardEvent) => void)[] = [];
afterEach(() => {
  for (const listener of gameListeners.splice(0)) window.removeEventListener('keydown', listener);
  document.body.replaceChildren();
});

function setup() {
  const plane = document.body;
  const gameKeys = vi.fn();
  window.addEventListener('keydown', gameKeys);
  gameListeners.push(gameKeys);
  const buttons = (): string[] =>
    [...plane.querySelectorAll('.on-system-confirm__actions button')].map((b) => b.textContent ?? '');
  return { plane, gameKeys, buttons, note: openSubMissionWindow(1, 'start') };
}

const press = (key: string): void => {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true }),
  );
};

it('holds the paused game under an undismissable loading note', () => {
  const h = setup();
  const dialog = h.plane.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain(copy.title);
  expect(dialog?.textContent).toContain(copy.loading);
  expect(h.plane.querySelector('.on-window__close')).toBeNull();
  expect(h.buttons()).toEqual([]);
  press('Escape');
  press('a');
  expect(h.gameKeys).not.toHaveBeenCalled();
  expect(h.plane.querySelector('.on-system-confirm')).not.toBeNull();
  h.note.dispose();
  expect(h.plane.querySelector('.on-system-confirm')).toBeNull();
  press('a');
  expect(h.gameKeys).toHaveBeenCalledOnce();
});

it('names the way back to the parent map as a return, not a next mission', () => {
  openSubMissionWindow(1, 'end');
  const dialog = document.body.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain(copy.returnTitle);
  expect(dialog?.textContent).not.toContain(copy.title);
});

it('turns a failure into staying or a retry, the retry focused', () => {
  const h = setup();
  const retry = vi.fn();
  const stay = vi.fn();
  h.note.failed(retry, stay);
  expect(h.plane.textContent).toContain(copy.failed);
  expect(h.buttons()).toEqual([copy.stay, copy.retry]);
  expect(document.activeElement?.textContent).toBe(copy.retry);
  (document.activeElement as HTMLButtonElement).click();
  expect(retry).toHaveBeenCalledOnce();
  expect(stay).not.toHaveBeenCalled();
  expect(h.plane.querySelector('.on-system-confirm')).toBeNull();
});

it('stays up when the game under it is torn down, and owns the keys over an open question', () => {
  const game = document.createElement('div');
  document.body.append(game);
  const ask = createHudConfirm(game);
  void ask({ title: 'T', message: 'M', cancel: 'Keep', confirm: 'Go' });
  const h = setup();
  game.remove();
  h.note.failed(() => {});
  expect(document.activeElement?.textContent).toBe(copy.retry);
  press('Tab');
  expect(document.activeElement?.textContent).toBe(copy.retry);
  press('Escape');
  expect(h.plane.querySelector('.on-system-confirm')).not.toBeNull();
  h.note.dispose();
  press('a');
  expect(h.gameKeys).toHaveBeenCalledOnce();
});

it('offers only the retry once the world is already gone', () => {
  const h = setup();
  h.note.failed(() => {});
  expect(h.buttons()).toEqual([copy.retry]);
});
