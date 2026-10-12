import { messages } from '../../i18n/index.js';
import { backTarget, type MenuScreen } from './model.js';

/** The back+title header every sub-screen opens with; screens append their own tools after.
 *  `target` names where the back button leads when the screen opens from more than one place. */
export function screenHead(
  screen: Exclude<MenuScreen, 'main'>,
  open: (screen: MenuScreen) => void,
  target: MenuScreen = backTarget(screen) ?? 'main',
): HTMLDivElement {
  const copy = messages().mainMenu;
  const head = document.createElement('div');
  head.className = 'main-menu__screen-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'main-menu__back';
  back.textContent = `← ${target === 'newGame' ? copy.backLabels.newGame : copy.backLabels.main}`;
  back.addEventListener('click', () => open(target));
  const title = document.createElement('h1');
  title.className = 'main-menu__screen-title';
  title.textContent = copy.screenTitles[screen];
  head.append(back, title);
  return head;
}
