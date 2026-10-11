import { type Messages, messages } from '../../i18n/index.js';
import type { MenuSettings } from '../settings-store.js';

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

/** What the in-game settings page does as it closes: `note` hears the labels of the restart-bound
 *  settings it left changed, and nothing when every one is back at its opening value. */
export function noteRestartOnLeave(
  note: (labels: readonly string[]) => void,
): (opened: MenuSettings, closed: MenuSettings) => void {
  return (opened, closed) => {
    const changed = settingsAwaitingRestart(opened, closed);
    if (changed.length > 0) note(restartSettingLabels(changed));
  };
}
