import { WINDOW_REGION_TOP } from '../../../hud/regions.js';

/** How long a refused order's strip stays up. */
const NOTICE_MS = 6000;

/** The strip under the window region that says why an order was refused. */
export function createOrderNotice(plane: HTMLElement): { show(text: string): void; dispose(): void } {
  const element = document.createElement('div');
  element.className = 'on-strip';
  element.setAttribute('role', 'status');
  element.hidden = true;
  element.style.top = `${WINDOW_REGION_TOP}px`;
  element.style.pointerEvents = 'none';
  element.style.zIndex = '20';
  const text = document.createElement('span');
  text.className = 'on-strip__text';
  element.append(text);
  plane.append(element);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show: (message) => {
      clearTimeout(timer);
      text.textContent = message;
      element.hidden = false;
      timer = setTimeout(() => {
        element.hidden = true;
        timer = undefined;
      }, NOTICE_MS);
    },
    dispose: () => {
      clearTimeout(timer);
      element.remove();
    },
  };
}
