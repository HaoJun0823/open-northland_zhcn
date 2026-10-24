import { type Messages, messages } from '../../i18n/index.js';
import type { MenuSettings } from '../settings/store.js';

/** The stored settings a map reads only as it starts; every other one reaches a running game at once. */
export const SETTINGS_NEEDING_MAP_RESTART = [
  // The canvas's backing resolution, fixed when the Pixi application is created.
  'renderScale',
  // Both handed to the world renderer as it is built.
  'spriteSmoothing',
  'postFxEnabled',
  // The HUD keeps the language the map started in; the change only rewrites the page address.
  'language',
] as const satisfies readonly (keyof MenuSettings)[];

export type RestartSetting = (typeof SETTINGS_NEEDING_MAP_RESTART)[number];

/** The settings-page label of each restart-bound setting. */
const LABEL_KEYS = {
  renderScale: 'renderScale',
  spriteSmoothing: 'spriteSmoothing',
  postFxEnabled: 'postFx',
  language: 'language',
} as const satisfies Readonly<Record<RestartSetting, keyof Messages['mainMenu']['settings']>>;

/** The restart-bound settings that `closed` holds at another value than `opened`, in list order. */
export function settingsAwaitingRestart(opened: MenuSettings, closed: MenuSettings): RestartSetting[] {
  return SETTINGS_NEEDING_MAP_RESTART.filter((key) => opened[key] !== closed[key]);
}

/** The settings' labels in the language the HUD shows. */
function restartSettingLabels(settings: readonly RestartSetting[]): string[] {
  const copy = messages().mainMenu.settings;
  return settings.map((key) => copy[LABEL_KEYS[key]]);
}

/** What the in-game settings page does as it closes after changing a restart-bound setting: `note`
 *  hears the labels of every one that now differs from the value the map started on (`started`), none
 *  when all are back at it. A visit that changed none of them says nothing. */
export function noteRestartOnLeave(
  started: MenuSettings,
  note: (labels: readonly string[]) => void,
): (opened: MenuSettings, closed: MenuSettings) => void {
  return (opened, closed) => {
    if (settingsAwaitingRestart(opened, closed).length === 0) return;
    note(restartSettingLabels(settingsAwaitingRestart(started, closed)));
  };
}
