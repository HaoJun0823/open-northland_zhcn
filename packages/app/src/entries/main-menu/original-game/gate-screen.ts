import type { FolderReader } from '@open-northland/ownership';
import { diag } from '../../../diag/index.js';
import { messages } from '../../../i18n/index.js';
import { BRAND_LOGO_STACKED, BRAND_LOGO_STACKED_SIZE } from '../../../view/brand-art.js';
import { type DesktopOriginalGame, desktopOriginalGame } from '../../../view/original-game-check.js';
import { node } from '../dom.js';
import { directoryHandleReader, directoryPicker, fileListReader } from './browser-folder-reader.js';
import {
  type InstallCheck,
  type OriginalGameGateStatus,
  type OriginalGameRecord,
  originalGameGate,
  readerCheck,
} from './gate.js';

const STORE_PAGES: readonly { readonly name: string; readonly href: string }[] = [
  { name: 'Steam', href: 'https://store.steampowered.com/app/351870/' },
  { name: 'GOG', href: 'https://www.gog.com/game/cultures_34' },
];

/** A picker the player closed without choosing throws this; it is no failure. */
const PICK_CANCELLED = 'AbortError';

async function pickWithPicker(): Promise<FolderReader | undefined> {
  const picker = directoryPicker();
  if (picker === undefined) return undefined;
  try {
    return directoryHandleReader(await picker({ mode: 'read' }));
  } catch (err) {
    if (!(err instanceof DOMException && err.name === PICK_CANCELLED)) {
      diag.warn('menu', 'original-game gate: the directory picker failed', err);
    }
    return undefined;
  }
}

/** The desktop shell's dialog checks the folder itself; only its answer crosses the bridge. */
async function pickWithShell(desktop: DesktopOriginalGame): Promise<InstallCheck | undefined> {
  const picked = await desktop.pickFolder();
  if (picked.cancelled) return undefined;
  return async () => (picked.verified ? { label: picked.label } : undefined);
}

/**
 * The screen shown before the menu until a picked folder passes the shared rule. A browser picks
 * through its directory picker, or the `webkitdirectory` input where that is missing; the desktop
 * shell through its own folder dialog.
 */
export function originalGameGateScreen(
  remember: (record: OriginalGameRecord) => Promise<unknown>,
  onVerified: () => void,
  desktop: DesktopOriginalGame | null = desktopOriginalGame(),
): HTMLElement {
  const copy = messages().mainMenu.originalGame;
  const gate = originalGameGate(remember);
  const section = node('section', 'main-menu__screen main-menu__gate');
  const body = node('div', 'main-menu__gate-body');

  const logo = node('img', 'main-menu__gate-logo');
  logo.src = BRAND_LOGO_STACKED;
  logo.alt = 'Open Northland';
  logo.width = BRAND_LOGO_STACKED_SIZE.width;
  logo.height = BRAND_LOGO_STACKED_SIZE.height;
  logo.decoding = 'async';

  const pick = node('button', 'main-menu__ghost is-accent main-menu__gate-pick', copy.pick);
  pick.type = 'button';
  const input = node('input', 'main-menu__gate-input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.hidden = true;
  const status = node('p', 'main-menu__gate-status');
  status.setAttribute('role', 'status');

  const show = (next: OriginalGameGateStatus): void => {
    pick.disabled = next === 'checking';
    status.classList.toggle('is-error', next === 'notRecognized');
    status.textContent =
      next === 'checking' ? copy.checking : next === 'notRecognized' ? copy.notRecognized : '';
  };
  const check = async (recognize: InstallCheck | undefined): Promise<void> => {
    const result = gate.check(recognize);
    show(gate.status);
    const settled = await result;
    show(settled);
    if (settled === 'verified') onVerified();
  };

  pick.addEventListener('click', () => {
    if (desktop !== null) {
      // The dialog is modal to the window, but a second click could land before it opens.
      pick.disabled = true;
      void pickWithShell(desktop)
        .catch((err: unknown) => {
          diag.warn('menu', 'original-game gate: the folder dialog failed', err);
          return undefined;
        })
        .then((recognize) => {
          show(gate.status);
          return check(recognize);
        });
      return;
    }
    if (directoryPicker() === undefined) {
      input.click();
      return;
    }
    void pickWithPicker().then((folder) => check(folder === undefined ? undefined : readerCheck(folder)));
  });
  input.addEventListener('change', () => {
    const files = input.files;
    void check(files === null || files.length === 0 ? undefined : readerCheck(fileListReader(files)));
    // A second pick of the same folder must fire `change` again.
    input.value = '';
  });

  const stores = node('div', 'main-menu__gate-stores');
  stores.append(node('span', 'main-menu__gate-stores-label', copy.buy));
  for (const store of STORE_PAGES) {
    const link = node('a', 'main-menu__ghost', store.name);
    link.href = store.href;
    link.target = '_blank';
    link.rel = 'noopener';
    stores.append(link);
  }

  body.append(logo, node('p', 'main-menu__gate-message', copy.message), pick, input, status, stores);
  if (desktop !== null) {
    const quit = node('button', 'main-menu__ghost main-menu__gate-quit', messages().mainMenu.items.exit);
    quit.type = 'button';
    quit.addEventListener('click', () => window.close());
    body.append(quit);
  }
  section.append(body);
  return section;
}
