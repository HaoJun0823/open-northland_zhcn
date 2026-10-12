import { messages } from '../../../i18n/index.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { type CatalogueMemory, catalogueView } from './view.js';

/** The catalogue as a main-menu screen; an installed map opens the lobby. Back leads to `back`: the
 *  main menu, or the map selection the player came from. */
export function catalogueScreen(
  open: (screen: MenuScreen) => void,
  back: MenuScreen,
  memory: CatalogueMemory,
  openLobby: (item: MapSelectItem) => void,
): MountedScreen {
  const section = document.createElement('section');
  section.className = 'main-menu__screen catalogue-screen';
  const head = screenHead('catalogue', open, back);
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const view = catalogueView({ memory, purpose: 'play', onPick: openLobby });
  view.tabs.setAttribute('aria-label', messages().mapCatalogue.open);
  tools.append(view.count, view.tabs);
  head.append(tools);
  section.append(head, view.body);
  return { element: section, dispose: view.dispose };
}
