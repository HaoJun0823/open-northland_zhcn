import { describe, expect, it, vi } from 'vitest';
import { createSettingsDisplayMode } from '../../../src/view/settings/display-mode.js';

/** A display whose fullscreen entry finishes only when the test says so; `granted` false denies every
 *  change, as a browser without a user gesture does. */
function displayHarness(options: { readonly startFullscreen?: boolean; readonly granted?: boolean } = {}) {
  const granted = options.granted ?? true;
  let finishEnter = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    finishEnter = resolve;
  });
  const state = { fullscreen: options.startFullscreen ?? false };
  const leave = vi.fn(async () => {
    if (granted) state.fullscreen = false;
  });
  const commit = vi.fn(async () => true);
  const settled = vi.fn();
  const display = createSettingsDisplayMode({
    current: () => (state.fullscreen ? 'fullscreen' : 'window'),
    enter: async () => {
      if (!granted) return;
      await entered;
      state.fullscreen = true;
    },
    leave,
    commit,
    onSettled: settled,
  });
  const whenSettled = () => vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  return { display, state, leave, commit, finishEnter, whenSettled };
}

describe('createSettingsDisplayMode', () => {
  it('applies the latest request after an older fullscreen request finishes', async () => {
    const { display, state, commit, finishEnter, whenSettled } = displayHarness();
    display.request('fullscreen');
    display.request('window');
    finishEnter();
    await whenSettled();
    expect(state.fullscreen).toBe(false);
    expect(commit).toHaveBeenCalledExactlyOnceWith('window');
  });

  it('does not persist a fullscreen request the browser denied', async () => {
    const { display, commit, whenSettled } = displayHarness({ granted: false });
    display.request('fullscreen');
    await whenSettled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('can reserve a later intent without applying it until its transaction succeeds', async () => {
    const { display, state, commit, finishEnter, whenSettled } = displayHarness();
    display.request('fullscreen');
    const restore = display.reserve('window');
    finishEnter();
    await vi.waitFor(() => expect(state.fullscreen).toBe(true));
    expect(commit).not.toHaveBeenCalled();
    restore.apply();
    await whenSettled();
    expect(state.fullscreen).toBe(false);
    expect(commit).toHaveBeenLastCalledWith('window');
  });

  it('cancels a reserved intent when its transaction fails', async () => {
    const { display, state, leave, commit, finishEnter, whenSettled } = displayHarness();
    display.request('fullscreen');
    const restore = display.reserve('window');
    finishEnter();
    await vi.waitFor(() => expect(state.fullscreen).toBe(true));
    restore.cancel();
    await whenSettled();
    expect(state.fullscreen).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith('fullscreen');
  });

  it('does not apply a reservation superseded by a later explicit request', async () => {
    const { display, state, commit, finishEnter, whenSettled } = displayHarness();
    const restore = display.reserve('window');
    display.request('fullscreen');
    restore.apply();
    finishEnter();
    await whenSettled();
    expect(state.fullscreen).toBe(true);
    expect(commit).toHaveBeenLastCalledWith('fullscreen');
  });

  it('does not persist window when a reserved exit from fullscreen was denied', async () => {
    const { display, commit, whenSettled } = displayHarness({ startFullscreen: true, granted: false });
    display.reserve('window').apply();
    await whenSettled();
    expect(commit).not.toHaveBeenCalled();
  });
});
