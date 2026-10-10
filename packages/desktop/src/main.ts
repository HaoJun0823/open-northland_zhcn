import { join, resolve } from 'node:path';
import { app, type BrowserWindow, Menu } from 'electron';
import { applicationMenuTemplate } from './application-menu.js';
import { installCandidates } from './original-game/candidates.js';
import {
  detectInstall,
  hostCandidateEnvironment,
  ORIGINAL_GAME_DIR_ENV,
  originalGameCheckWanted,
} from './original-game/detect.js';
import { passOriginalGameGate } from './original-game/gate.js';
import { promptForInstall } from './original-game/prompt.js';
import {
  ORIGINAL_GAME_STATE_FILE,
  readOriginalGameState,
  writeOriginalGameState,
} from './original-game/state.js';
import { CONTENT_DIR_ENV, resolveShellRoots } from './paths.js';
import { handleAppProtocol, registerAppScheme } from './protocol.js';
import { createWindow } from './window.js';
import { WINDOW_STATE_FILE } from './window-state.js';

// scripts/bundle.mjs emits main.cjs into dist/.
const packageRoot = resolve(__dirname, '..');
const roots = resolveShellRoots({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot: resolve(packageRoot, '../..'),
  contentDirOverride: process.env[CONTENT_DIR_ENV],
});

// One window per profile: a second instance would share the IndexedDB the saves live in.
if (app.requestSingleInstanceLock()) {
  registerAppScheme();

  let mainWindow: BrowserWindow | undefined;
  app.on('second-instance', () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    const menu = applicationMenuTemplate(process.platform, app.isPackaged);
    Menu.setApplicationMenu(menu === null ? null : Menu.buildFromTemplate([...menu]));
    handleAppProtocol(roots);
    const originalGamePath = join(app.getPath('userData'), ORIGINAL_GAME_STATE_FILE);
    const passed =
      !originalGameCheckWanted(app.isPackaged, process.env) ||
      (await passOriginalGameGate({
        readState: () => readOriginalGameState(originalGamePath),
        detect: () =>
          detectInstall(process.env[ORIGINAL_GAME_DIR_ENV], () =>
            installCandidates(hostCandidateEnvironment()),
          ),
        prompt: promptForInstall,
        writeState: (state) => writeOriginalGameState(originalGamePath, state),
      }));
    if (!passed) {
      app.quit();
      return;
    }
    mainWindow = createWindow(join(app.getPath('userData'), WINDOW_STATE_FILE));
  });
} else {
  app.quit();
}

// Quits on macOS too: a single-window game shell has nothing to reopen from the Dock.
app.on('window-all-closed', () => app.quit());
