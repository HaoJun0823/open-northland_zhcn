import { app, dialog, type OpenDialogOptions, shell } from 'electron';
import { type DetectedInstall, recognizeFolder } from './detect.js';
import { originalGamePromptFor } from './prompt-text.js';

/** Button order of the dialog; closing it counts as quitting. */
const PICK_BUTTON = 0;
const BUY_BUTTON = 1;
const QUIT_BUTTON = 2;

const STORE_PAGES = [
  'https://store.steampowered.com/app/351870/',
  'https://www.gog.com/game/cultures_34',
  'https://apps.apple.com/app/id702843717',
];

/** Blocks until the player picks a recognized folder or quits; call after `ready`. */
export async function promptForInstall(): Promise<DetectedInstall | undefined> {
  const text = originalGamePromptFor(app.getLocale());
  const properties: OpenDialogOptions['properties'] = ['openDirectory'];
  // A Mac App Store copy is an `.app` bundle, which the picker otherwise treats as a file.
  if (process.platform === 'darwin') properties.push('treatPackageAsDirectory');
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: text.title,
      message: text.message,
      buttons: [text.pick, text.buy, text.quit],
      defaultId: PICK_BUTTON,
      cancelId: QUIT_BUTTON,
      noLink: true,
    });
    if (response === PICK_BUTTON) {
      const picked = await dialog.showOpenDialog({ title: text.pick, properties });
      const folder = picked.filePaths[0];
      if (picked.canceled || folder === undefined) continue;
      const found = await recognizeFolder(folder);
      if (found !== undefined) return found;
      await dialog.showMessageBox({
        type: 'error',
        title: text.title,
        message: text.notRecognized,
        buttons: [text.back],
      });
    } else if (response === BUY_BUTTON) {
      for (const page of STORE_PAGES) await shell.openExternal(page);
    } else {
      return undefined;
    }
  }
}
