import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentLocale, setActiveLocale } from '../../../src/i18n/index.js';
import {
  noteRestartOnLeave,
  SETTINGS_NEEDING_MAP_RESTART,
  settingsAwaitingRestart,
} from '../../../src/view/runtime/settings-restart.js';
import { defaultSettings } from '../../../src/view/settings/store.js';

const locale = currentLocale();
beforeEach(() => setActiveLocale('eng'));
afterEach(() => setActiveLocale(locale));

describe('settings needing a map restart', () => {
  const opened = defaultSettings();

  it('lists the restart-bound settings left changed, in list order', () => {
    const language = opened.language === 'pol' ? 'eng' : 'pol';
    const closed = { ...opened, language, renderScale: opened.renderScale / 2 } as const;
    expect(settingsAwaitingRestart(opened, closed)).toEqual(['renderScale', 'language']);
  });

  it('leaves out the settings a running game applies at once, the frame-rate limit among them', () => {
    expect(SETTINGS_NEEDING_MAP_RESTART).not.toContain('fpsLimit');
    const closed = {
      ...opened,
      fpsLimit: 30,
      uiScaleFactor: opened.uiScaleFactor * 2,
      weather: !opened.weather,
      displayMode: 'fullscreen',
    } as const;
    expect(settingsAwaitingRestart(opened, closed)).toEqual([]);
  });

  it('names the changed settings by their labels and stays quiet for a change undone', () => {
    const note = vi.fn();
    const leave = noteRestartOnLeave(opened, note);
    leave(opened, {
      ...opened,
      postFxEnabled: !opened.postFxEnabled,
      spriteSmoothing: !opened.spriteSmoothing,
    });
    expect(note).toHaveBeenCalledExactlyOnceWith(['Sprite smoothing', 'Post-processing']);
    note.mockClear();
    leave(opened, { ...opened });
    expect(note).not.toHaveBeenCalled();
  });

  it('measures each visit against the settings the map started on', () => {
    const note = vi.fn();
    const leave = noteRestartOnLeave(opened, note);
    const halfScale = { ...opened, renderScale: opened.renderScale / 2 };
    leave(opened, halfScale);
    // A later visit's change keeps naming the earlier one still waiting.
    const noFx = { ...halfScale, postFxEnabled: !opened.postFxEnabled };
    leave(halfScale, noFx);
    // Undoing both withdraws the note, since the running map already shows them.
    leave(noFx, opened);
    expect(note.mock.calls).toEqual([[['Render scale']], [['Render scale', 'Post-processing']], [[]]]);
  });
});
