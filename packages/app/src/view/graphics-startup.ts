import { diag } from '../diag/log.js';
import { recommendGraphics } from './graphics-defaults.js';
import { detectedWebglRenderer } from './graphics-hardware.js';
import { defaultSettings, initializeStoredSettings, type MenuSettings } from './settings-store.js';

/** Also used by the player's explicit restore-defaults action; never by a live frame loop. */
export function recommendedSettings(): MenuSettings {
  const renderer = detectedWebglRenderer();
  const recommendation = recommendGraphics(renderer, {
    width: Math.max(window.innerWidth, window.screen.width),
    height: Math.max(window.innerHeight, window.screen.height),
    dpr: window.devicePixelRatio,
  });
  diag.info('boot', 'graphics defaults selected', { renderer, ...recommendation });
  return { ...defaultSettings(), ...recommendation.settings };
}

export function initializeGraphicsSettings(): void {
  initializeStoredSettings(recommendedSettings);
}
