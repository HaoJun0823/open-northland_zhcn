// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createMatchResultOverlay, type MatchResultOverlay } from '../src/hud/dom/match-result.js';

const overlays: MatchResultOverlay[] = [];
afterEach(() => {
  for (const overlay of overlays.splice(0)) overlay.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function setup(sharedClock: boolean) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const pause = vi.fn();
  const resume = vi.fn();
  const onQuit = vi.fn();
  const onContinue = vi.fn();
  const hud = document.createElement('div');
  document.body.append(hud);
  const overlay = createMatchResultOverlay({
    localPlayer: 0,
    sharedClock,
    pause,
    resume,
    onQuit,
    onContinue,
    hud: { element: hud, currentScale: () => 1 },
    onOpen: vi.fn(),
    setCameraSuspended: vi.fn(),
  });
  overlays.push(overlay);
  const body = {
    buttons: () => [...document.querySelectorAll<HTMLButtonElement>('.on-result button')],
    get children() {
      return document.querySelectorAll('.on-result-backdrop');
    },
  };
  return { body, pause, resume, onQuit, onContinue, overlay, hud };
}

it('lets a defeated player watch without pausing and inspect the map after the match ends', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  expect(h.body.buttons()).toHaveLength(2);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  expect(h.body.children).toHaveLength(0);
  expect(h.pause).not.toHaveBeenCalled();
  expect(h.resume).not.toHaveBeenCalled();
  h.overlay.finish('defeat');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  h.overlay.finish('defeat');
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(1);
  h.body.buttons()[1]?.click();
  expect(h.onQuit).toHaveBeenCalledOnce();
  expect(h.body.children).toHaveLength(0);
});

it('replaces an open earlier defeat and supports an observer without a local outcome', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  h.overlay.finish('undecided');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  h.overlay.dispose();
  expect(h.body.children).toHaveLength(0);
});

it.each(['victory', 'defeat'] as const)(
  'continues a local %s without quitting and restores input',
  (outcome) => {
    const h = setup(false);
    h.overlay.announce(outcome);
    expect(h.hud.inert).toBe(true);
    expect(h.pause).toHaveBeenCalledOnce();
    expect(h.body.buttons()).toHaveLength(2);
    h.body.buttons()[0]?.dispatchEvent(new Event('click'));
    expect(h.resume).toHaveBeenCalledOnce();
    expect(h.onContinue).toHaveBeenCalledOnce();
    expect(h.onQuit).not.toHaveBeenCalled();
    expect(h.hud.inert).not.toBe(true);
    h.overlay.announce('victory');
    expect(h.body.children).toHaveLength(0);
  },
);

it('waits for server confirmation before showing shared victory', () => {
  const h = setup(true);
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(0);
  h.overlay.finish('victory');
  expect(h.body.buttons()).toHaveLength(2);
  expect(h.pause).not.toHaveBeenCalled();
});

it.each(['playerWon', 'playerDefeated'] as const)(
  'shows an immediate scripted %s in a shared game without pausing it',
  (kind) => {
    const h = setup(true);
    h.overlay.onEvents([{ kind, player: 0, scripted: true }]);
    expect(h.body.children).toHaveLength(1);
    expect(h.body.buttons()).toHaveLength(2);
    expect(h.pause).not.toHaveBeenCalled();
    h.body.buttons()[0]?.dispatchEvent(new Event('click'));
    h.overlay.onEvents([{ kind, player: 0 }]);
    expect(h.body.children).toHaveLength(0);
    h.overlay.finish(kind === 'playerWon' ? 'victory' : 'defeat');
    expect(h.body.buttons()).toHaveLength(2);
  },
);

it('does not let a suppressed shared victory hide a later scripted notice in the same frame', () => {
  const h = setup(true);
  h.overlay.onEvents([
    { kind: 'playerWon', player: 0 },
    { kind: 'playerWon', player: 0, scripted: true },
  ]);
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  expect(h.pause).not.toHaveBeenCalled();
});

it.each(['playerWon', 'playerDefeated'] as const)(
  'does not redisplay a previously announced %s after loading a save',
  (kind) => {
    const h = setup(false);
    h.overlay.onEvents([{ kind, player: 0, notificationAlreadySent: true }]);
    expect(h.body.children).toHaveLength(0);
    expect(h.pause).not.toHaveBeenCalled();
  },
);

it('keeps keyboard focus in the result, cancels leaving, and resumes with Escape', async () => {
  const h = setup(false);
  h.hud.tabIndex = 0;
  h.hud.focus();
  h.overlay.announce('defeat');
  const [stay, quit] = h.body.buttons();
  expect(document.activeElement).toBe(stay);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  expect(document.activeElement).toBe(quit);
  quit?.click();
  expect(document.querySelector('.on-system-confirm')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await Promise.resolve();
  expect(h.onQuit).not.toHaveBeenCalled();
  expect(h.overlay.isOpen()).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(h.onContinue).toHaveBeenCalledOnce();
  expect(h.overlay.isOpen()).toBe(false);
  expect(document.activeElement).toBe(h.hud);
});

it('cancels an outstanding quit confirmation when disposed', async () => {
  const h = setup(false);
  h.overlay.announce('defeat');
  h.body.buttons()[1]?.click();
  h.overlay.dispose();
  await Promise.resolve();
  expect(h.onQuit).not.toHaveBeenCalled();
  expect(h.resume).toHaveBeenCalledOnce();
  expect(document.querySelector('.on-system-confirm')).toBeNull();
});
