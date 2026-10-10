import { messages } from '../../../i18n/index.js';
import { type CatalogueBrowser, catalogueBrowser } from '../catalogue/browser.js';
import { initialCatalogueMemory } from '../catalogue/model.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { mapPicker } from '../map-picker.js';
import { type MapSelectItem, type MapSelectMemory, ROOM_TABS } from '../map-select-model.js';

interface MapPickOptions {
  readonly memory: MapSelectMemory;
  readonly onChoose: (item: MapSelectItem) => void;
  readonly onBack: () => void;
  readonly onMaps: (maps: readonly MapSelectItem[]) => void;
}

/** The New Game map list under the room listing, with a way back to the create card and the map
 *  catalogue in its place, since leaving the screen would drop the relay connection. */
export function roomMapPick(options: MapPickOptions) {
  const copy = messages();
  const element = node('div', 'network-menu__pick');
  element.hidden = true;
  const head = node('div', 'main-menu__screen-head');
  const back = node('button', 'main-menu__back', `← ${copy.mainMenu.screenTitles.multiplayer}`);
  back.type = 'button';
  const title = node('h1', 'main-menu__screen-title', copy.network.chooseMap);
  const tools = node('div', 'main-menu__head-tools');
  const picker = mapPicker({
    memory: options.memory,
    listing: 'multiplayer',
    tabs: ROOM_TABS,
    // A room needs a seat for its creator; the original's list does not look at the roster.
    include: (item) => hasClaimableSeat(item.players),
    primaryLabel: () => copy.network.choose,
    onPrimary: options.onChoose,
    onMaps: options.onMaps,
  });
  const catalogueMemory = initialCatalogueMemory('multi');
  let catalogue: CatalogueBrowser | null = null;
  const openButton = node('button', 'main-menu__ghost catalogue__open', copy.mapCatalogue.open);
  openButton.type = 'button';

  function closeCatalogue(): boolean {
    if (catalogue === null) return false;
    catalogue.dispose();
    catalogue.tabs.remove();
    catalogue.body.remove();
    catalogue = null;
    title.textContent = copy.network.chooseMap;
    back.textContent = `← ${copy.mainMenu.screenTitles.multiplayer}`;
    openButton.hidden = false;
    picker.body.hidden = false;
    picker.tabs.hidden = ROOM_TABS.length === 0;
    back.focus();
    return true;
  }
  function openCatalogue(): void {
    if (catalogue !== null) return;
    catalogue = catalogueBrowser({
      memory: catalogueMemory,
      purpose: 'choose',
      onPick(item) {
        closeCatalogue();
        options.onChoose(item);
      },
      onInstalledChanged: picker.reload,
    });
    title.textContent = copy.mapCatalogue.open;
    back.textContent = `← ${copy.network.chooseMap}`;
    openButton.hidden = true;
    picker.body.hidden = true;
    picker.tabs.hidden = true;
    tools.append(catalogue.tabs);
    element.append(catalogue.body);
    back.focus();
  }
  back.addEventListener('click', () => {
    if (!closeCatalogue()) options.onBack();
  });
  openButton.addEventListener('click', openCatalogue);
  tools.append(openButton, picker.tabs);
  head.append(back, title, tools);
  element.append(head, picker.body);
  return {
    element,
    select: picker.select,
    /** True when the catalogue was open and is now closed, back on the map list. */
    closeCatalogue,
    dispose(): void {
      catalogue?.dispose();
    },
  };
}
