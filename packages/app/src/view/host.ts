import type { DesktopMaps } from './desktop-bridge.js';
import type { DesktopFullscreen } from './fullscreen.js';
import type { DesktopOriginalGame } from './original-game-check.js';

declare global {
  interface Window {
    /** The desktop shell's preload bridge; absent in a browser. */
    readonly desktop?: {
      readonly fullscreen: DesktopFullscreen;
      readonly originalGame: DesktopOriginalGame;
      /** Absent in a shell build without the installed-map store. */
      readonly maps?: DesktopMaps;
    };
  }
}

/** The schemes a browser serves the app from; the desktop shell serves its own. */
const BROWSER_PROTOCOLS: readonly string[] = ['http:', 'https:'];

export function servedByBrowser(): boolean {
  return BROWSER_PROTOCOLS.includes(window.location.protocol);
}
