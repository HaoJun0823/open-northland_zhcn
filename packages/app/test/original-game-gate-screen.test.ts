// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { OriginalGameRecord } from '../src/entries/main-menu/original-game/gate.js';
import { originalGameGateScreen } from '../src/entries/main-menu/original-game/gate-screen.js';
import { messages, setActiveLocale } from '../src/i18n/index.js';
import type { DesktopOriginalGamePick } from '../src/view/platform/original-game-check.js';
import { fakeShell } from './support/original-game-shell.js';

const CANCELLED: DesktopOriginalGamePick = { verified: false, label: null, cancelled: true };
const UNRECOGNIZED: DesktopOriginalGamePick = { verified: false, label: null, cancelled: false };
const RECOGNIZED: DesktopOriginalGamePick = {
  verified: true,
  label: 'Cultures: Northland (PL)',
  cancelled: false,
};

describe('originalGameGateScreen on the desktop', () => {
  it('picks through the shell: a failure line, a cancel that keeps it, then a pass', async () => {
    setActiveLocale('eng');
    const copy = messages().mainMenu.originalGame;
    const records: OriginalGameRecord[] = [];
    let verified = 0;
    const screen = originalGameGateScreen(
      async (record) => records.push(record),
      () => {
        verified += 1;
      },
      fakeShell({ required: true, verified: false }, [UNRECOGNIZED, CANCELLED, RECOGNIZED]),
    );
    const pick = screen.querySelector<HTMLButtonElement>('.main-menu__gate-pick');
    const status = screen.querySelector('.main-menu__gate-status');
    if (pick === null || status === null) throw new Error('the gate screen lost its pick button or status');
    expect(pick.textContent).toBe(copy.pick);
    expect(status.textContent).toBe('');

    pick.click();
    await vi.waitFor(() => expect(status.textContent).toBe(copy.notRecognized));
    expect(status.classList.contains('is-error')).toBe(true);
    expect(pick.disabled).toBe(false);

    pick.click();
    expect(pick.disabled).toBe(true);
    await vi.waitFor(() => expect(pick.disabled).toBe(false));
    expect(status.textContent).toBe(copy.notRecognized);
    expect(records).toEqual([]);

    pick.click();
    await vi.waitFor(() => expect(verified).toBe(1));
    expect(records).toEqual([
      { originalGameVerified: true, originalGameLabel: 'Cultures: Northland (PL)', originalGameFolder: null },
    ]);
  });

  it('offers an exit on the desktop only; a browser tab cannot close itself', () => {
    setActiveLocale('eng');
    const closed = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const onDesktop = originalGameGateScreen(
      async () => undefined,
      () => undefined,
      fakeShell({ required: true, verified: false }),
    );
    const quit = onDesktop.querySelector<HTMLButtonElement>('.main-menu__gate-quit');
    if (quit === null) throw new Error('the desktop gate screen has no exit');
    expect(quit.textContent).toBe(messages().mainMenu.items.exit);
    quit.click();
    expect(closed).toHaveBeenCalledTimes(1);

    const inBrowser = originalGameGateScreen(
      async () => undefined,
      () => undefined,
      null,
    );
    expect(inBrowser.querySelector('.main-menu__gate-quit')).toBeNull();
    closed.mockRestore();
  });
});
