import { messages } from '../../../i18n/index.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { catalogueBrowser } from './browser.js';
import type { CatalogueMemory } from './model.js';

/** The catalogue as a main-menu screen, reached from New Game; an installed map opens the lobby. */
export function catalogueScreen(
  open: (screen: MenuScreen) => void,
  memory: CatalogueMemory,
  openLobby: (item: MapSelectItem) => void,
): MountedScreen {
  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__map-select catalogue-screen';
  const head = screenHead('catalogue', open);
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const browser = catalogueBrowser({ memory, purpose: 'play', onPick: openLobby });
  browser.tabs.setAttribute('aria-label', messages().mapCatalogue.open);
  tools.append(browser.tabs);
  head.append(tools);
  section.append(head, browser.body);
  return { element: section, dispose: browser.dispose };
}
