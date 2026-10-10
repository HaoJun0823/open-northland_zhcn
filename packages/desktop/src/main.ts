import { join, resolve } from 'node:path';
import { app, type BrowserWindow, Menu } from 'electron';
import { applicationMenuTemplate } from './application-menu.js';
import { describeGpuInfo } from './gpu-info.js';
import { installCandidates } from './original-game/candidates.js';
import {
  detectInstall,
  hostCandidateEnvironment,
  ORIGINAL_GAME_DIR_ENV,
  originalGameCheckWanted,
  recognizeFolder,
} from './original-game/detect.js';
import { type OriginalGameRecord, rememberDetectedInstall } from './original-game/gate.js';
import {
  ORIGINAL_GAME_STATE_FILE,
  readOriginalGameState,
  writeOriginalGameState,
} from './original-game/state.js';
import { CONTENT_DIR_ENV, installedMapsRoot, resolveShellRoots } from './paths.js';
import { GAME_URL, handleAppProtocol, registerAppScheme } from './protocol.js';
import { API_URL_ENV, initialGameUrl } from './protocol-routing.js';
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

// A dual-GPU laptop otherwise runs the GPU process on the adapter Windows assigns, usually the
// integrated one; a single-GPU machine is unaffected. Whether it took effect shows in the startup GPU
// line and the FPS counter's adapter name (unconfirmed on a dual-GPU Windows machine).
app.commandLine.appendSwitch('force_high_performance_gpu');

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
    const userData = app.getPath('userData');
    const mapsRoot = installedMapsRoot(userData);
    handleAppProtocol(roots, mapsRoot);
    const originalGamePath = join(userData, ORIGINAL_GAME_STATE_FILE);
    const originalGame: OriginalGameRecord = {
      required: originalGameCheckWanted(app.isPackaged, process.env),
      readState: () => readOriginalGameState(originalGamePath),
      writeState: (state) => writeOriginalGameState(originalGamePath, state),
      recognize: recognizeFolder,
    };
    await rememberDetectedInstall(originalGame, () =>
      detectInstall(process.env[ORIGINAL_GAME_DIR_ENV], () => installCandidates(hostCandidateEnvironment())),
    );
    mainWindow = createWindow({
      statePath: join(userData, WINDOW_STATE_FILE),
      mapsRoot,
      startUrl: initialGameUrl(GAME_URL, process.env[API_URL_ENV]),
      originalGame,
    });
    app.getGPUInfo('basic').then(
      (info) => console.info(describeGpuInfo(info)),
      () => console.info(describeGpuInfo(null)),
    );
  });
} else {
  app.quit();
}

// Quits on macOS too: a single-window game shell has nothing to reopen from the Dock.
app.on('window-all-closed', () => app.quit());
