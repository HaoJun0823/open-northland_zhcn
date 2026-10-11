import { contextBridge, ipcRenderer } from 'electron';
import {
  FULLSCREEN_CHANGED_CHANNEL,
  IS_FULLSCREEN_CHANNEL,
  SET_FULLSCREEN_CHANNEL,
} from './fullscreen-channels.js';
import type { OriginalGamePick, OriginalGameStatus } from './original-game/gate.js';
import { ORIGINAL_GAME_STATUS_CHANNEL, PICK_ORIGINAL_GAME_CHANNEL } from './original-game-channels.js';

// The app reads the mode synchronously, so the preload mirrors it: asked once, then kept by the events.
let active = ipcRenderer.sendSync(IS_FULLSCREEN_CHANNEL) === true;
const listeners = new Set<() => void>();
ipcRenderer.on(FULLSCREEN_CHANGED_CHANNEL, (_event, next: unknown) => {
  active = next === true;
  for (const listener of listeners) listener();
});

// The shape `packages/app/src/view/host.ts` declares as `window.desktop`.
contextBridge.exposeInMainWorld('desktop', {
  fullscreen: {
    isActive: (): boolean => active,
    set: async (next: unknown): Promise<void> => {
      await ipcRenderer.invoke(SET_FULLSCREEN_CHANNEL, next === true);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
  originalGame: {
    status: (): Promise<OriginalGameStatus> => ipcRenderer.invoke(ORIGINAL_GAME_STATUS_CHANNEL),
    pickFolder: (): Promise<OriginalGamePick> => ipcRenderer.invoke(PICK_ORIGINAL_GAME_CHANNEL),
  },
});
